/**
 * 真实浏览器冒烟测试：把扩展加载进 Chrome(headless=new)，
 * 打开 popup.html，验证「生成 → 解码 → UI 交互」整条链路。
 * 运行：node test/browser-smoke.js
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXT = path.join(__dirname, '..');
const PORT = 9333;
// 注意：正式版 Google Chrome 会忽略 --load-extension / --disable-extensions-except
// （扩展加载策略限制），因此优先使用 Edge 做端到端测试。
const CHROME_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

async function getJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('无法连接调试端口: ' + url);
}

/** 极简 CDP 客户端 */
class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.events = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(new Error('WS 错误')));
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP 超时: ' + method));
        }
      }, 30000);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception
        ? (r.exceptionDetails.exception.description || r.exceptionDetails.exception.value)
        : r.exceptionDetails.text);
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

(async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.log('SKIP: 未找到 Chrome/Edge，跳过浏览器测试');
    process.exit(0);
  }
  console.log('浏览器:', browser);

  const profile = path.join(os.tmpdir(), 'qr-tool-test-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--disable-extensions-except=' + EXT,
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--load-extension=' + EXT,
    'about:blank'
  ];
  const proc = spawn(browser, args, { stdio: 'ignore' });

  let cdp = null, sw = null, page = null;
  const result = { ok: false, steps: [], errors: [] };
  const log = (s) => { result.steps.push(s); console.log(s); };

  try {
    const version = await getJson(`http://127.0.0.1:${PORT}/json/version`);
    log('✓ 调试端口已就绪：' + version.Browser);

    // 1. 找到本扩展的 Service Worker（必须以 /background.js 结尾，避免误判其他内置扩展）
    let targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
    for (let i = 0; i < 40 && !sw; i++) {
      targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      sw = targets.find((t) => t.type === 'service_worker' && /\/background\.js$/.test(t.url));
      if (!sw) await sleep(250);
    }
    if (!sw) throw new Error('未发现本扩展的 Service Worker（扩展加载失败）');
    const extId = new URL(sw.url).host;
    log('✓ 扩展已加载，ID = ' + extId);

    // 2. 由扩展自身打开 popup.html
    //    注意：CDP 的 Target.createTarget 打开 chrome-extension:// 会被 Chrome 拦截成错误页，
    //    必须让扩展通过 chrome.tabs.create 自己打开。
    const swCdp = new CDP(sw.webSocketDebuggerUrl);
    await swCdp.ready;
    await swCdp.send('Runtime.enable');
    await sleep(400);
    await swCdp.evaluate(`(async () => { await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') }); return 'created'; })()`);
    await sleep(1200);

    targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
    const pageInfo = targets.find((t) => t.type === 'page' && t.url.endsWith('popup.html'));
    if (!pageInfo) throw new Error('未能打开 popup.html');
    log('✓ popup.html 已打开');

    page = new CDP(pageInfo.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    await page.send('Page.enable');
    await sleep(900);

    const loc = await page.evaluate('location.href');
    if (!/^chrome-extension:\/\//.test(loc)) throw new Error('popup.html 加载异常，当前地址：' + loc);

    // 3. 基础环境检查
    const basic = await page.evaluate(`(() => ({
      hasQRCodeLib: typeof qrcode === 'function',
      hasJsQR: typeof jsQR === 'function',
      hasDecode: typeof QRToolDecode === 'object' && typeof QRToolDecode.decodeDataURL === 'function',
      tabs: document.querySelectorAll('.tab').length,
      buttons: document.querySelectorAll('button').length
    }))()`);
    log('  环境：qrcode=' + basic.hasQRCodeLib + ' jsQR=' + basic.hasJsQR +
        ' decode=' + basic.hasDecode + ' 标签=' + basic.tabs + ' 按钮=' + basic.buttons);
    if (!basic.hasQRCodeLib || !basic.hasJsQR || !basic.hasDecode) throw new Error('扩展页面脚本未正确加载');

    // 4. 走真实 UI：切到「生成」页 → 输入内容 → 生成 → 解码回来
    const gen = await page.evaluate(`(async () => {
      document.querySelector('.tab[data-tab="make"]').click();
      const ta = document.getElementById('mk-text');
      const text = '浏览器端到端测试 QR-Toolkit 2026 ✔';
      ta.value = text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 500));
      const canvas = document.getElementById('mk-canvas');
      const dataUrl = canvas.toDataURL('image/png');
      const hitCanvas = await QRToolDecode.decodeDataURL(dataUrl);
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 't.png', { type: 'image/png' });
      const hitFile = await QRToolDecode.decodeFile(file);
      return {
        panelActive: document.getElementById('panel-make').classList.contains('active'),
        canvasSize: canvas.width + 'x' + canvas.height,
        emptyHidden: canvas.parentElement.classList.contains('has-qr'),
        downloadEnabled: !document.getElementById('btn-mk-download').disabled,
        copyImgEnabled: !document.getElementById('btn-mk-copyimg').disabled,
        errText: document.getElementById('mk-error').textContent,
        expect: text,
        hitCanvas: hitCanvas ? hitCanvas.data : null,
        hitFile: hitFile ? hitFile.data : null
      };
    })()`);

    const genOk = gen.panelActive && gen.hitCanvas === gen.expect && gen.hitFile === gen.expect &&
      gen.downloadEnabled && gen.copyImgEnabled && !gen.errText;
    log((genOk ? '✓' : '✗') + ` 生成→解码往返：canvas=${gen.canvasSize} 解码(canvas)=${JSON.stringify(gen.hitCanvas)} 解码(File)=${JSON.stringify(gen.hitFile)}`);
    log('  预览生效=' + gen.emptyHidden + ' 按钮已启用=' + gen.downloadEnabled + ' 报错=' + JSON.stringify(gen.errText));

    // 5. 识别页：模拟上传解码（走 decodeFile）
    const scan = await page.evaluate(`(async () => {
      document.querySelector('.tab[data-tab="scan"]').click();
      const ta = document.getElementById('mk-text');
      ta.value = 'https://www.qq.com/qr?id=999';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      const dataUrl = document.getElementById('mk-canvas').toDataURL('image/png');
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'upload.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('file');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1200));
      const res = document.getElementById('result');
      return {
        resultVisible: !res.classList.contains('hidden'),
        label: document.getElementById('r-label').textContent,
        text: document.getElementById('r-text').textContent,
        meta: document.getElementById('r-meta').textContent,
        openVisible: !document.getElementById('btn-open').classList.contains('hidden'),
        histCount: document.querySelectorAll('#hist .hist-item').length
      };
    })()`);
    const scanOk = scan.resultVisible && scan.text === 'https://www.qq.com/qr?id=999' &&
      scan.label === '网址' && scan.openVisible;
    log((scanOk ? '✓' : '✗') + ` 上传识别：结果卡显示=${scan.resultVisible} 类型=${scan.label} 内容=${JSON.stringify(scan.text)} 历史=${scan.histCount} 条`);

    // 6. 一键复制
    const copy = await page.evaluate(`(async () => {
      document.getElementById('btn-copy').click();
      await new Promise(r => setTimeout(r, 400));
      return document.getElementById('btn-copy').textContent;
    })()`);
    const copyOk = /已复制/.test(copy);
    log((copyOk ? '✓' : '✗') + ' 一键复制按钮反馈：' + copy);

    // 7. 收集控制台错误
    const consoleErrors = page.events
      .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      .map((e) => (e.params.args || []).map((a) => a.value || a.description).join(' '));
    const logErrors = page.events
      .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
      .map((e) => e.params.entry.text);
    const allErr = consoleErrors.concat(logErrors)
      .filter((t) => t && !/favicon|net::ERR_/i.test(t));
    log((allErr.length ? '✗' : '✓') + ' 控制台错误：' + (allErr.length ? JSON.stringify(allErr) : '无'));

    result.ok = genOk && scanOk && copyOk && allErr.length === 0;
    result.errors = allErr;
  } catch (e) {
    log('✗ 测试异常：' + e.message);
    result.errors.push(e.message);
  } finally {
    if (page) page.close();
    if (cdp) cdp.close();
    try { proc.kill(); } catch (e) {}
    await sleep(600);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n===== 浏览器冒烟测试结果 =====');
  console.log(result.ok ? '全部通过 ✔' : '存在失败项 ✘');
  process.exit(result.ok ? 0 : 1);
})();
