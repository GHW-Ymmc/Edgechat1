import { deleteSession, getSession, isAdminUser, putSession } from './auth.js';
import { isUserDisabled } from './user-status.js';
import { AUTHORIZATION_COLUMNS, AUTHORIZATION_JOIN, authorizationFromRow } from './rbac/authorization.ts';

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export async function validateSession(env, token, { management = false, profile = false } = {}) {
  const session = await getSession(env, token);
  if (!session) {
    return { ok: false, status: 401, message: '请先登录' };
  }

  const { results } = await env.DB.prepare(
    `SELECT u.username, u.is_disabled, u.disabled_until, u.deleted_at, u.session_version, u.is_super_admin
       ${profile ? ', u.display_name, u.avatar_key, u.bio' : ''}
       ${management ? `, ${AUTHORIZATION_COLUMNS}` : ''}
     FROM users u ${management ? AUTHORIZATION_JOIN : ''}
     WHERE u.id = ?
     LIMIT 1`
  )
    .bind(session.userId)
    .all();

  const user = results[0];
  if (!user || user.deleted_at || isUserDisabled(user)) {
    await deleteSession(env, token);
    return { ok: false, status: 401, message: '账号已不可用' };
  }

  if (session.deviceSessionId) {
    const device = await env.DB.prepare(
      `SELECT session_version
       FROM device_sessions
       WHERE id = ?
         AND user_id = ?
         AND revoked_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`
    )
      .bind(String(session.deviceSessionId), session.userId)
      .all();
    const deviceSession = device.results[0];
    if (!deviceSession || toNumber(deviceSession.session_version) !== toNumber(user.session_version)) {
      await deleteSession(env, token);
      return { ok: false, status: 401, message: '设备登录已失效，请重新登录' };
    }
  }

  const dbVersion = toNumber(user.session_version);
  const sessionVersion = toNumber(session.sessionVersion);
  if (sessionVersion !== dbVersion) {
    await deleteSession(env, token);
    return { ok: false, status: 401, message: '登录已过期，请重新登录' };
  }

  const refreshed = {
    ...session,
    ...(profile ? {
      username: user.username,
      displayName: user.display_name,
      bio: user.bio ?? '',
      avatarUrl: user.avatar_key ? `/files/${encodeURIComponent(user.avatar_key)}` : ''
    } : {}),
    isAdmin: isAdminUser(env, user),
    isSuperAdmin: Boolean(user.is_super_admin),
    ...(management ? authorizationFromRow(user) : {}),
    sessionVersion: dbVersion
  };

  // 恢复接口直接复用本次鉴权的最新资料；仅资料确实改变时写回，避免每次启动续写 KV。
  const profileChanged = profile && ['username', 'displayName', 'bio', 'avatarUrl']
    .some((key) => refreshed[key] !== session[key]);
  if (profileChanged || refreshed.isAdmin !== session.isAdmin || refreshed.sessionVersion !== session.sessionVersion) {
    await putSession(env, refreshed);
  }

  return { ok: true, session: refreshed };
}

