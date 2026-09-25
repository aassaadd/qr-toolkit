/**
 * 算法级往返自测（Node 环境，无需浏览器）
 * 覆盖：生成二维码 → 渲染为像素 → 多轮解码 → 文本比对
 * 运行：node test/roundtrip.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const jsQR = require(path.join(ROOT, 'lib', 'jsQR.js'));
const qrcode = require(path.join(ROOT, 'lib', 'qrcode.js'));

// 让 decode.js 能在 Node 里加载，并单独测试其中的纯函数 classify()
global.window = global;
require(path.join(ROOT, 'lib', 'decode.js'));
const classify = global.QRToolDecode.classify;

/* ---------------- 渲染：模块矩阵 → RGBA ---------------- */
function render(qr, cell, margin, fg, bg) {
  fg = fg || [0, 0, 0];
  bg = bg || [255, 255, 255];
  const count = qr.getModuleCount();
  const size = (count + margin * 2) * cell;
  const buf = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mr = Math.floor(y / cell) - margin;
      const mc = Math.floor(x / cell) - margin;
      const dark = mr >= 0 && mc >= 0 && mr < count && mc < count && qr.isDark(mr, mc);
      const c = dark ? fg : bg;
      const i = (y * size + x) * 4;
      buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
    }
  }
  return { data: buf, width: size, height: size };
}

/* ---------------- 与 decode.js 一致的降级策略 ---------------- */
function scan(imageData) {
  try {
    return jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
  } catch (e) { return null; }
}

function binarize(imageData) {
  const d = imageData.data, len = d.length;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < len; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
    hist[g]++;
  }
  const total = len / 4;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, max = 0, thres = 128;
  for (let k = 0; k < 256; k++) {
    wB += hist[k];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += k * hist[k];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; thres = k; }
  }
  for (let j = 0; j < len; j += 4) {
    const v = d[j] > thres ? 255 : 0;
    d[j] = d[j + 1] = d[j + 2] = v;
  }
  return imageData;
}

function upscale(imageData, scale) {
  const w = imageData.width * scale, h = imageData.height * scale;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < w; x++) {
      const sx = Math.floor(x / scale);
      const si = (sy * imageData.width + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = imageData.data[si];
      out[di + 1] = imageData.data[si + 1];
      out[di + 2] = imageData.data[si + 2];
      out[di + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

function decodeMultiPass(imageData) {
  let hit = scan(imageData);
  if (hit) return hit;
  const copy = { data: new Uint8ClampedArray(imageData.data), width: imageData.width, height: imageData.height };
  hit = scan(binarize(copy));
  if (hit) return hit;
  for (const s of [2, 3]) {
    const up = upscale(imageData, s);
    hit = scan(up);
    if (hit) return hit;
    const up2 = { data: new Uint8ClampedArray(up.data), width: up.width, height: up.height };
    hit = scan(binarize(up2));
    if (hit) return hit;
  }
  return null;
}

function makeQR(text, ecc) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const qr = qrcode(0, ecc || 'M');
  qr.addData(text);
  qr.make();
  return qr;
}

/* ---------------- 用例 ---------------- */
const CASES = [
  { name: '纯文本', text: 'hello world', ecc: 'M', cell: 4, margin: 3, fg: [0, 0, 0], bg: [255, 255, 255] },
  { name: '网址', text: 'https://www.qq.com/qr?id=12345&from=ext', ecc: 'M', cell: 4, margin: 3, fg: [0, 0, 0], bg: [255, 255, 255] },
  { name: '中文', text: '二维码工具箱：一键识别与生成', ecc: 'M', cell: 4, margin: 3, fg: [0, 0, 0], bg: [255, 255, 255] },
  { name: '中文+英文+emoji', text: '你好 WorkBuddy 🎉 测试 emoji', ecc: 'Q', cell: 5, margin: 3, fg: [0, 0, 0], bg: [255, 255, 255] },
  { name: 'WiFi 配置', text: 'WIFI:T:WPA;S:MyHome_5G;P:12345678;;', ecc: 'M', cell: 4, margin: 3, fg: [0, 0, 0], bg: [255, 255, 255] },
  { name: '较长文本(200字)', text: 'A'.repeat(200), ecc: 'L', cell: 3, margin: 3, fg: [0, 0, 0], bg: [255, 255, 255] },
  { name: '极低分辨率(cell=2)', text: 'https://a.cn/x', ecc: 'L', cell: 2, margin: 2, fg: [0, 0, 0], bg: [255, 255, 255] },
  { name: '深蓝前景色', text: 'color-test-2026', ecc: 'M', cell: 4, margin: 3, fg: [15, 23, 42], bg: [255, 255, 255] },
  { name: '浅底深字(低对比)', text: 'low-contrast-QR', ecc: 'M', cell: 4, margin: 3, fg: [40, 40, 40], bg: [235, 235, 235] },
  { name: '窄静区(margin=1)', text: 'tiny-margin', ecc: 'M', cell: 4, margin: 1, fg: [0, 0, 0], bg: [255, 255, 255] }
];

const TYPE_CASES = [
  ['https://example.com/a', 'url'],
  ['www.qq.com', 'url'],
  ['WIFI:T:WPA;S:MyHome;P:12345678;;', 'wifi'],
  ['BEGIN:VCARD\nFN:张三\nEND:VCARD', 'vcard'],
  ['mailto:a@b.com', 'mailto'],
  ['tel:+8613800000000', 'tel'],
  ['1234567890123', 'barcode'],
  ['就是一段普通文字', 'text']
];

let pass = 0, fail = 0;
const failures = [];

console.log('===== 生成 → 识别 往返测试 =====');
for (const c of CASES) {
  let qr;
  try {
    qr = makeQR(c.text, c.ecc);
  } catch (e) {
    fail++; failures.push(`${c.name}: 生成异常 ${e.message}`);
    console.log(`✗ ${c.name.padEnd(22)} 生成失败: ${e.message}`);
    continue;
  }
  const img = render(qr, c.cell, c.margin, c.fg, c.bg);
  const hit = decodeMultiPass(img);
  const ok = hit && hit.data === c.text;
  if (ok) {
    pass++;
    console.log(`✓ ${c.name.padEnd(22)} ${img.width}x${img.height}px  ${qr.getModuleCount()}模块  内容长度=${c.text.length}`);
  } else {
    fail++;
    const got = hit ? JSON.stringify(hit.data.slice(0, 30)) : 'null';
    failures.push(`${c.name}: 期望 ${JSON.stringify(c.text.slice(0, 20))} 得到 ${got}`);
    console.log(`✗ ${c.name.padEnd(22)} ${img.width}x${img.height}px  解码结果=${got}`);
  }
}

console.log('\n===== 内容类型识别测试 =====');
for (const [text, expect] of TYPE_CASES) {
  const got = classify(text).kind;
  if (got === expect) {
    pass++;
    console.log(`✓ ${JSON.stringify(text.slice(0, 26)).padEnd(34)} → ${got}`);
  } else {
    fail++;
    failures.push(`classify(${text}) 期望 ${expect} 得到 ${got}`);
    console.log(`✗ ${JSON.stringify(text.slice(0, 26)).padEnd(34)} → ${got}（期望 ${expect}）`);
  }
}

console.log('\n===== 汇总 =====');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (failures.length) {
  console.log('失败明细：');
  failures.forEach((f) => console.log('  - ' + f));
}
process.exit(fail === 0 ? 0 : 1);
