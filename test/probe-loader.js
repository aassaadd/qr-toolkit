// 探测：哪种方式能在本机浏览器里把未打包扩展加载起来
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const EXT = process.argv[2] || process.cwd();
const BROWSER = process.argv[3] || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MODE = process.argv[4] || 'switch';
const PORT = Number(process.argv[5] || 9400);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = path.join(os.tmpdir(), 'qrt-probe-' + Date.now());
fs.mkdirSync(profile, { recursive: true });

const args = [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile
];
if (MODE === 'switch') {
  args.push('--disable-extensions-except=' + EXT, '--load-extension=' + EXT);
} else {
  args.push('--enable-unsafe-extension-debugging');
}
args.push('about:blank');

console.log('浏览器:', BROWSER, '模式:', MODE);
const proc = spawn(BROWSER, args, { stdio: ['ignore', 'ignore', 'pipe'] });
let logs = '';
proc.stderr.on('data', d => { logs += d.toString(); });

async function getJson(u) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(u); if (r.ok) return r.json(); } catch (e) {}
    await sleep(250);
  }
  throw new Error('端口未就绪');
}

(async () => {
  try {
    const v = await getJson(`http://127.0.0.1:${PORT}/json/version`);
    console.log('版本:', v.Browser);
    await sleep(2000);

    if (MODE !== 'switch') {
      // 尝试通过 CDP 的 Extensions 域加载未打包扩展
      const ws = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise(r => ws.addEventListener('open', r));
      let seq = 0; const pend = new Map();
      ws.addEventListener('message', ev => {
        const m = JSON.parse(ev.data);
        if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      });
      const send = (method, params = {}) => new Promise(res => {
        const id = ++seq; pend.set(id, res);
        ws.send(JSON.stringify({ id, method, params }));
      });
      const r = await send('Extensions.loadUnpacked', { path: EXT });
      console.log('Extensions.loadUnpacked ->', JSON.stringify(r).slice(0, 400));
      await sleep(1500);
    }

    const list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
    console.log('--- targets ---');
    list.forEach(t => console.log(t.type, '|', t.url));
    const ours = list.find(t => t.type === 'service_worker' && /\/background\.js$/.test(t.url));
    console.log(ours ? '✅ 本扩展已加载: ' + ours.url : '❌ 本扩展未加载');
  } catch (e) {
    console.log('探测异常:', e.message);
  } finally {
    try { proc.kill(); } catch (e) {}
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    const bad = logs.split(/\r?\n/).filter(l => /not allowed|Failed to load extension|error/i.test(l)).slice(0, 5);
    if (bad.length) console.log('--- 关键日志 ---'), bad.forEach(l => console.log(l.slice(0, 220)));
    process.exit(0);
  }
})();
