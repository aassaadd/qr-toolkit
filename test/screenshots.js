/**
 * 生成扩展真实界面截图（用于文档展示）
 * 运行：node test/screenshots.js
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
const PORT = 9350;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0; this.pending = new Map();
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
      }
    });
  }
  send(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('超时 ' + method)); } }, 30000);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
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

(async function main() {
  const browser = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p));
  if (!browser) { console.log('SKIP: 未找到 Edge'); process.exit(0); }

  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(os.tmpdir(), 'qrt-shot-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT,
    '--force-device-scale-factor=2', 'about:blank'
  ], { stdio: 'ignore' });

  try {
    const version = await getJson(`http://127.0.0.1:${PORT}/json/version`);
    let list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
    let sw = null;
    for (let i = 0; i < 40 && !sw; i++) {
      list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      sw = list.find((t) => t.type === 'service_worker' && /\/background\.js$/.test(t.url));
      if (!sw) await sleep(250);
    }
    if (!sw) throw new Error('扩展未加载');

    const swCdp = new CDP(sw.webSocketDebuggerUrl);
    await swCdp.ready;
    await swCdp.send('Runtime.enable');
    await sleep(300);
    await swCdp.evaluate(`(async () => { await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') }); return 1; })()`);
    await sleep(1200);

    list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
    const pi = list.find((t) => t.type === 'page' && t.url.endsWith('popup.html'));
    const page = new CDP(pi.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Runtime.enable');
    await sleep(800);

    // 清空历史，保证截图干净
    await page.evaluate(`chrome.storage.local.set({history:[]})`);
    await page.evaluate(`chrome.storage.session.set({lastResult:null})`);
    await page.evaluate(`document.getElementById('hist-wrap').classList.add('hidden')`);

    const height = Math.ceil(await page.evaluate(`document.querySelector('.app').getBoundingClientRect().height`));
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 384, height, deviceScaleFactor: 2, mobile: false
    });
    await sleep(400);

    async function shot(name) {
      const r = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      const file = path.join(OUT, name);
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      console.log('✓ ' + file + '  (' + fs.statSync(file).size + ' bytes)');
    }

    // 1) 识别页（空状态）
    await shot('popup-scan.png');

    // 2) 识别页（带识别结果）
    await page.evaluate(`(async () => {
      document.querySelector('.tab[data-tab="make"]').click();
      const ta = document.getElementById('mk-text');
      ta.value = 'https://www.qq.com/qr?id=8888&from=toolkit';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      const blob = await (await fetch(document.getElementById('mk-canvas').toDataURL('image/png'))).blob();
      document.querySelector('.tab[data-tab="scan"]').click();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'qrcode.png', { type: 'image/png' }));
      const input = document.getElementById('file');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1200));
    })()`);
    const h2 = Math.ceil(await page.evaluate(`document.querySelector('.app').getBoundingClientRect().height`));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 384, height: h2, deviceScaleFactor: 2, mobile: false });
    await sleep(400);
    await shot('popup-result.png');

    // 3) 生成页
    await page.evaluate(`(async () => {
      document.querySelector('.tab[data-tab="make"]').click();
      const ta = document.getElementById('mk-text');
      ta.value = 'https://www.qq.com/qr?id=8888';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 500));
    })()`);
    const h3 = Math.ceil(await page.evaluate(`document.querySelector('.app').getBoundingClientRect().height`));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 384, height: h3, deviceScaleFactor: 2, mobile: false });
    await sleep(400);
    await shot('popup-generate.png');

    page.close();
    swCdp.close();
  } catch (e) {
    console.log('✗ 截图失败：' + e.message);
  } finally {
    try { proc.kill(); } catch (e) {}
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    process.exit(0);
  }
})();
