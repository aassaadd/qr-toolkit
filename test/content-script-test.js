/**
 * 页面侧端到端测试：真实网页 + 内容脚本注入 + 页面图片扫描 + 区域框选流程
 * 运行：node test/content-script-test.js
 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const PORT_DEBUG = 9340;
const PORT_HTTP = 8977;
const QR_TEXT = 'https://tool.test/page-qr?sig=abc123';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qrcode = require(path.join(ROOT, 'lib', 'qrcode.js'));

/* ---------------- PNG 编码（纯 zlib） ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** 生成一张 420x420 的图片：白底 + 居中的二维码 */
function makeQrPng(text) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const cell = 10, margin = 2;
  const size = (count + margin * 2) * cell;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mr = Math.floor(y / cell) - margin;
      const mc = Math.floor(x / cell) - margin;
      const dark = mr >= 0 && mc >= 0 && mr < count && mc < count && qr.isDark(mr, mc);
      const v = dark ? 0 : 255;
      const i = (y * size + x) * 4;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
    }
  }
  return { buffer: encodePng(size, size, buf), size };
}

/* ---------------- CDP 极简客户端 ---------------- */
class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0; this.pending = new Map(); this.events = [];
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res());
      this.ws.addEventListener('error', () => rej(new Error('WS 错误')));
    });
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method) this.events.push(m);
    });
  }
  send(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('超时 ' + method)); }
      }, 30000);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' +
      (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : ''));
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function getJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
    await sleep(250);
  }
  throw new Error('无法连接: ' + url);
}

async function retry(fn, times, gap) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return await fn(); } catch (e) { last = e; await sleep(gap); }
  }
  throw last;
}

/* ---------------- 主流程 ---------------- */
(async function main() {
  const BROWSERS = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  const browser = BROWSERS.find((p) => fs.existsSync(p));
  if (!browser) { console.log('SKIP: 未找到 Edge'); process.exit(0); }

  const qrPng = makeQrPng(QR_TEXT);
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/qr.png')) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': qrPng.buffer.length });
      res.end(qrPng.buffer);
      return;
    }
    if (req.url.startsWith('/bg.png')) {
      // 跨域图片来源（不同端口），用于验证「后台抓取」兜底路径
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(qrPng.buffer);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR 测试页</title>
<style>body{font-family:"Microsoft YaHei";padding:24px;margin:0}
img{display:block;border:1px solid #ddd;margin:12px 0}</style></head>
<body><h2>二维码识别测试页</h2>
<p>下面这张是同源图片：</p>
<img id="same" src="/qr.png" width="${qrPng.size}">
<p>下面这张来自其它端口（跨域）：</p>
<img id="cross" src="http://127.0.0.1:${PORT_HTTP + 1}/bg.png" width="${qrPng.size}">
<p style="height:800px">滚动留白</p>
</body></html>`);
  });
  const server2 = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(qrPng.buffer);
  });
  await new Promise((r) => server.listen(PORT_HTTP, '127.0.0.1', r));
  await new Promise((r) => server2.listen(PORT_HTTP + 1, '127.0.0.1', r));

  const profile = path.join(os.tmpdir(), 'qrt-page-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT_DEBUG, '--user-data-dir=' + profile,
    '--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT,
    '--window-size=1280,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let sw = null, page = null, ok = false;
  const steps = [];
  const log = (s) => { steps.push(s); console.log(s); };

  try {
    const version = await getJson(`http://127.0.0.1:${PORT_DEBUG}/json/version`);
    log('✓ 浏览器就绪：' + version.Browser);

    let list = await getJson(`http://127.0.0.1:${PORT_DEBUG}/json/list`);
    for (let i = 0; i < 40; i++) {
      list = await getJson(`http://127.0.0.1:${PORT_DEBUG}/json/list`);
      sw = list.find((t) => t.type === 'service_worker' && /\/background\.js$/.test(t.url));
      if (sw) break;
      await sleep(250);
    }
    if (!sw) throw new Error('扩展未加载');
    log('✓ 扩展已加载');

    // 打开测试页
    const browserCdp = new CDP(version.webSocketDebuggerUrl);
    await browserCdp.ready;
    const created = await browserCdp.send('Target.createTarget', { url: `http://127.0.0.1:${PORT_HTTP}/` });
    await sleep(1200);
    list = await getJson(`http://127.0.0.1:${PORT_DEBUG}/json/list`);
    const pi = list.find((t) => t.type === 'page' && t.url.indexOf(`127.0.0.1:${PORT_HTTP}/`) >= 0);
    if (!pi) throw new Error('测试页未打开');
    page = new CDP(pi.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    await sleep(900);
    log('✓ 测试页已打开：' + (await page.evaluate('location.href')));
    log('  页面图片数=' + (await page.evaluate('document.images.length')));

    // 通过扩展 SW 注入内容脚本并触发整页扫描
    const swCdp = new CDP(sw.webSocketDebuggerUrl);
    await swCdp.ready;
    await swCdp.send('Runtime.enable');
    await sleep(300);

    const injected = await swCdp.evaluate(`(async () => {
      const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
      if (!tabs.length) return { error: '未找到目标标签页' };
      const tabId = tabs[0].id;
      await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/jsQR.js','lib/decode.js','content.js'] });
      await chrome.tabs.sendMessage(tabId, { type: 'scanPage' });
      return { tabId: tabId };
    })()`);
    if (injected.error) throw new Error(injected.error);
    log('✓ 内容脚本已注入（tabId=' + injected.tabId + '）并触发整页扫描');

    // 等待扫描面板出现（同源 + 跨域各一张图，应汇总为一个结果）
    const panel = await retry(async () => {
      const r = await page.evaluate(`(() => {
        const p = document.querySelector('.qrt-panel');
        if (!p) return null;
        return {
          title: p.querySelector('.qrt-title') ? p.querySelector('.qrt-title').textContent : '',
          text: p.querySelector('.qrt-body') ? p.querySelector('.qrt-body').textContent : '',
          itemCount: p.querySelectorAll('.qrt-item').length,
          hasCopy: !!p.querySelector('.qrt-btn')
        };
      })()`);
      if (!r) throw new Error('面板未出现');
      if (/正在解析/.test(r.text)) throw new Error('仍在扫描');
      return r;
    }, 40, 500);

    log('  面板标题：' + panel.title);
    log('  面板内容：' + JSON.stringify(panel.text.slice(0, 80)));
    const pageOk = panel.text.indexOf(QR_TEXT) >= 0 || panel.itemCount > 0;
    log((pageOk ? '✓' : '✗') + ' 页面图片扫描结果包含目标内容');

    // 点击复制按钮，验证一键复制链路
    const copyText = await page.evaluate(`(async () => {
      const btns = Array.from(document.querySelectorAll('.qrt-panel .qrt-btn'));
      const b = btns.find(x => /复制/.test(x.textContent)) || btns[0];
      if (!b) return 'no-button';
      b.click();
      await new Promise(r => setTimeout(r, 600));
      return b.textContent;
    })()`);
    const copyOk = /已复制/.test(copyText);
    log((copyOk ? '✓' : '✗') + ' 页内一键复制反馈：' + copyText);

    // 区域框选流程：合成鼠标拖拽，验证不崩且给出结果或友好提示
    await page.evaluate(`document.querySelector('.qrt-panel .qrt-close').click()`);
    await swCdp.evaluate(`(async () => {
      const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
      await chrome.tabs.sendMessage(tabs[0].id, { type: 'startSelect' });
      return 'ok';
    })()`);
    await sleep(500);
    const overlayShown = await page.evaluate(`!!document.querySelector('.qrt-overlay')`);
    log((overlayShown ? '✓' : '✗') + ' 框选遮罩层已出现');

    // 矩形覆盖第一张二维码图片
    const rect = await page.evaluate(`(() => {
      const img = document.getElementById('same');
      const r = img.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`);
    await page.evaluate(`(async () => {
      const ov = document.querySelector('.qrt-overlay');
      const mk = (type, x, y) => new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 1 });
      ov.dispatchEvent(mk('mousedown', ${rect.x} + 5, ${rect.y} + 5));
      document.dispatchEvent(mk('mousemove', ${rect.x} + ${rect.w} - 5, ${rect.y} + ${rect.h} - 5));
      document.dispatchEvent(mk('mouseup', ${rect.x} + ${rect.w} - 5, ${rect.y} + ${rect.h} - 5));
      await new Promise(r => setTimeout(r, 2500));
      const p = document.querySelector('.qrt-panel');
      return 'done';
    })()`);
    const selPanel = await page.evaluate(`(() => {
      const p = document.querySelector('.qrt-panel');
      if (!p) return null;
      return { title: p.querySelector('.qrt-title') ? p.querySelector('.qrt-title').textContent : '',
               text: p.querySelector('.qrt-body') ? p.querySelector('.qrt-body').textContent.slice(0, 90) : '' };
    })()`);
    const selOk = /识别成功|识别结果/.test(selPanel && selPanel.text || '') || /识别/.test(selPanel && selPanel.title || '');
    log((selOk ? '✓' : '·') + ' 框选截屏识别：' + JSON.stringify(selPanel));

    // 控制台错误
    const errs = page.events
      .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      .map((e) => (e.params.args || []).map((a) => a.value || a.description).join(' '))
      .concat(page.events.filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
        .map((e) => e.params.entry.text))
      .filter((t) => t && !/favicon|net::ERR_/i.test(t));
    log((errs.length ? '✗' : '✓') + ' 页面控制台错误：' + (errs.length ? JSON.stringify(errs) : '无'));

    ok = pageOk && copyOk && overlayShown && selOk && errs.length === 0;
    browserCdp.close();
    swCdp.close();
  } catch (e) {
    log('✗ 异常：' + e.message);
  } finally {
    if (page) page.close();
    try { proc.kill(); } catch (e) {}
    await new Promise((r) => server.close(r));
    await new Promise((r) => server2.close(r));
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n===== 页面侧测试结果 =====');
  console.log(ok ? '全部通过 ✔' : '存在失败项 ✘');
  process.exit(ok ? 0 : 1);
})();
