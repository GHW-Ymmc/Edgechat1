import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../frontend/src/styles/color-themes.css', import.meta.url), 'utf8');
const tokens = Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2]]));
const colors = name => tokens[name].match(/#[\da-f]{6}/gi);
function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

test('梦幻配色：大面积背景与默认按钮保持浅色，粉蓝渐变不再使用深玫瑰实底', () => {
  for (const token of ['--site-background', '--site-action-bg', '--auth-tide']) {
    assert.match(tokens[token], /linear-gradient/);
    for (const color of colors(token)) assert.ok(luminance(color) >= 0.7, `${token}: ${color}`);
  }
  for (let i = 0; i <= 10; i++) assert.ok(luminance(tokens[`--auth-wave-${i}`]) >= 0.65);
});

test('浅色按钮所有状态配深文字，正文与主题链接保持至少4.5:1对比度', () => {
  for (const token of ['--site-action-bg', '--site-action-hover', '--site-action-pressed']) {
    for (const background of colors(token)) {
      assert.ok(contrast(tokens['--site-on-action'], background) >= 4.5, `${token}: ${background}`);
    }
  }
  for (const [foreground, background] of [
    ['--site-brand', '--site-selected'],
    ['--chat-muted', '--chat-canvas'],
    ['--chat-subtle', '--chat-canvas'],
    ['--site-link', '--chat-outgoing']
  ]) assert.ok(contrast(tokens[foreground], tokens[background]) >= 4.5, foreground);
});

test('浅色预设不覆盖危险、警告、成功及在线提示的固定语义色', () => {
  for (const token of ['--chat-danger', '--chat-danger-soft', '--chat-online',
    '--admin-danger', '--admin-warning', '--admin-success']) {
    assert.equal(tokens[token], undefined);
  }
});
