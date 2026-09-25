/**
 * popup.js —— 弹窗交互逻辑
 */
'use strict';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* 通用工具                                                           */
/* ------------------------------------------------------------------ */
function bytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function showStatus(text) {
  $('status-text').textContent = text;
  $('status').classList.remove('hidden');
}
function hideStatus() {
  $('status').classList.add('hidden');
}

let toastTimer = null;
function toast(btn, okText, backText) {
  clearTimeout(toastTimer);
  btn.textContent = okText;
  toastTimer = setTimeout(() => { btn.textContent = backText; }, 1500);
}

function copyText(text) {
  return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

/* ------------------------------------------------------------------ */
/* 结果展示                                                           */
/* ------------------------------------------------------------------ */
let currentResult = null;

function showResult(text, from) {
  currentResult = text;
  const info = QRToolDecode.classify(text);
  $('r-label').textContent = info.label;
  $('r-meta').textContent = [from, text.length + ' 字符'].filter(Boolean).join(' · ');
  $('r-text').textContent = text;
  $('result').classList.remove('hidden');

  const btnOpen = $('btn-open');
  if (info.url) {
    btnOpen.classList.remove('hidden');
    btnOpen.onclick = () => chrome.tabs.create({ url: info.url });
  } else {
    btnOpen.classList.add('hidden');
    btnOpen.onclick = null;
  }
}

function hideResult() {
  $('result').classList.add('hidden');
  currentResult = null;
}

$('r-clear').addEventListener('click', hideResult);

$('btn-copy').addEventListener('click', () => {
  if (!currentResult) return;
  const btn = $('btn-copy');
  copyText(currentResult).then((ok) => toast(btn, ok ? '已复制 ✓' : '复制失败', '一键复制'));
});

/* ------------------------------------------------------------------ */
/* 历史记录                                                           */
/* ------------------------------------------------------------------ */
async function renderHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  const box = $('hist');
  box.textContent = '';
  if (!history.length) {
    $('hist-wrap').classList.add('hidden');
    return;
  }
  $('hist-wrap').classList.remove('hidden');
  history.slice(0, 8).forEach((h) => {
    const row = document.createElement('div');
    row.className = 'hist-item';
    row.title = h.text;
    const txt = document.createElement('div');
    txt.className = 'hist-txt';
    txt.textContent = h.text;
    const cp = document.createElement('div');
    cp.className = 'hist-cp';
    cp.textContent = '复制';
    row.appendChild(txt);
    row.appendChild(cp);
    row.addEventListener('click', () => {
      copyText(h.text).then((ok) => {
        cp.textContent = ok ? '已复制 ✓' : '失败';
        setTimeout(() => { cp.textContent = '复制'; }, 1400);
      });
    });
    box.appendChild(row);
  });
}

$('btn-clear-hist').addEventListener('click', async () => {
  await chrome.storage.local.set({ history: [] });
  await chrome.storage.session.set({ lastResult: null });
  renderHistory();
});

/* ------------------------------------------------------------------ */
/* 标签页切换                                                         */
/* ------------------------------------------------------------------ */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('active', p.id === 'panel-' + tab.dataset.tab);
    });
    if (tab.dataset.tab === 'make') renderQR();
  });
});

/* ------------------------------------------------------------------ */
/* 识别：文件 / 拖拽 / 粘贴                                            */
/* ------------------------------------------------------------------ */
async function decodeFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type) && !/\.(png|jpe?g|gif|bmp|webp|avif)$/i.test(file.name || '')) {
    showStatus('请选择图片文件');
    setTimeout(hideStatus, 1600);
    return;
  }
  hideResult();
  showStatus('正在解析「' + (file.name || '剪贴板图片') + '」…');
  try {
    const hit = await QRToolDecode.decodeFile(file);
    hideStatus();
    if (hit && hit.data) {
      showResult(hit.data, file.name || '上传图片');
      await chrome.runtime.sendMessage({ type: 'saveResult', text: hit.data, from: '上传图片' });
      renderHistory();
    } else {
      showStatus('未识别到二维码，可尝试更清晰的图片或先裁剪出二维码');
      setTimeout(hideStatus, 3000);
    }
  } catch (e) {
    hideStatus();
    showStatus('解析失败：' + e.message);
    setTimeout(hideStatus, 3000);
  }
}

const drop = $('drop');
drop.addEventListener('click', () => $('file').click());
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); }
});
$('file').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) decodeFile(f);
  e.target.value = '';
});

['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })
);
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); })
);
drop.addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) decodeFile(f);
});

document.addEventListener('paste', (e) => {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.type && it.type.indexOf('image') === 0) {
      const f = it.getAsFile();
      if (f) { e.preventDefault(); decodeFile(f); return; }
    }
  }
});

/* ------------------------------------------------------------------ */
/* 识别：框选屏幕 / 整页 / 页面图片                                     */
/* ------------------------------------------------------------------ */
const CONTENT_FILES = ['lib/jsQR.js', 'lib/decode.js', 'content.js'];

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function injectable(url) {
  if (!url) return false;
  return !/^(chrome|edge|about|devtools|chrome-extension|edge-extension|view-source|data):/i.test(url) &&
    !/^https?:\/\/(chromewebstore\.google\.com|microsoftedge\.microsoft\.com)/i.test(url);
}

$('btn-region').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab || !injectable(tab.url)) {
    showStatus('当前页面不支持框选识别（浏览器内置页面 / 扩展商店页）');
    setTimeout(hideStatus, 2600);
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
  } catch (e) { /* 已注入 */ }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'startSelect' });
    window.close();
  } catch (e) {
    showStatus('无法在当前页面启动框选：' + e.message);
    setTimeout(hideStatus, 3000);
  }
});

$('btn-viewport').addEventListener('click', async () => {
  hideResult();
  showStatus('正在截图并识别当前可视区域…');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'ui:captureViewport' });
    if (!res || !res.ok) throw new Error((res && res.error) || '截屏失败');
    const img = await loadImg(res.dataUrl);

    let hit = null;
    for (const maxSide of [1400, 2600]) {
      const canvas = QRToolDecode.drawToCanvas(img, maxSide, null);
      hit = QRToolDecode.decodeCanvas(canvas);
      if (hit) break;
    }
    hideStatus();
    if (hit && hit.data) {
      showResult(hit.data, '整页识别');
      await chrome.runtime.sendMessage({ type: 'saveResult', text: hit.data, from: '整页识别' });
      renderHistory();
    } else {
      showStatus('当前可视区域未发现二维码，试试「框选屏幕」提高精度');
      setTimeout(hideStatus, 3000);
    }
  } catch (e) {
    hideStatus();
    showStatus('识别失败：' + e.message);
    setTimeout(hideStatus, 3000);
  }
});

$('btn-page').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab || !injectable(tab.url)) {
    showStatus('当前页面不支持扫描（浏览器内置页面 / 扩展商店页）');
    setTimeout(hideStatus, 2600);
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
  } catch (e) { /* 已注入 */ }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'scanPage' });
    window.close();
  } catch (e) {
    showStatus('无法扫描当前页面：' + e.message);
    setTimeout(hideStatus, 3000);
  }
});

/* ------------------------------------------------------------------ */
/* 生成二维码                                                         */
/* ------------------------------------------------------------------ */
let lastQrDataUrl = null;

function renderQR() {
  const canvas = $('mk-canvas');
  const text = $('mk-text').value;
  const errBox = $('mk-error');
  const wrap = canvas.parentElement;
  const size = parseInt($('mk-size').value, 10);
  const ecc = $('mk-ecc').value;
  const fg = $('mk-fg').value;
  const bg = $('mk-bg').value;

  const setBtns = (on) => {
    $('btn-mk-copyimg').disabled = !on;
    $('btn-mk-download').disabled = !on;
    $('btn-mk-copytxt').disabled = !on;
  };

  if (!text) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = canvas.height = size;
    wrap.classList.remove('has-qr');
    errBox.textContent = '';
    lastQrDataUrl = null;
    setBtns(false);
    return;
  }

  try {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const qr = qrcode(0, ecc);          // 0 = 自动选择版本
    qr.addData(text);
    qr.make();

    const count = qr.getModuleCount();
    const margin = 3;                    // 静区模块数
    const cell = Math.max(1, Math.floor(size / (count + margin * 2)));
    const real = cell * (count + margin * 2);

    canvas.width = real;
    canvas.height = real;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, real, real);
    ctx.fillStyle = fg;
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
        }
      }
    }

    lastQrDataUrl = canvas.toDataURL('image/png');
    wrap.classList.add('has-qr');
    errBox.textContent = '';
    setBtns(true);
  } catch (e) {
    wrap.classList.remove('has-qr');
    lastQrDataUrl = null;
    setBtns(false);
    errBox.textContent = /overflow/i.test(e.message)
      ? '内容太长，无法生成二维码，请缩短内容或降低容错级别'
      : ('生成失败：' + e.message);
  }
}

let qrTimer = null;
const scheduleQR = () => {
  clearTimeout(qrTimer);
  qrTimer = setTimeout(renderQR, 120);
};

['mk-text', 'mk-size', 'mk-ecc', 'mk-fg', 'mk-bg'].forEach((id) => {
  const node = $(id);
  node.addEventListener(id === 'mk-text' ? 'input' : 'change', scheduleQR);
});

$('btn-mk-copytxt').addEventListener('click', () => {
  const btn = $('btn-mk-copytxt');
  copyText($('mk-text').value).then((ok) => toast(btn, ok ? '已复制 ✓' : '复制失败', '复制内容'));
});

$('btn-mk-copyimg').addEventListener('click', () => {
  const btn = $('btn-mk-copyimg');
  const canvas = $('mk-canvas');
  if (!lastQrDataUrl) return;
  canvas.toBlob(async (blob) => {
    if (!blob) { toast(btn, '失败', '复制图片'); return; }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(btn, '已复制 ✓', '复制图片');
    } catch (e) {
      toast(btn, '不支持', '复制图片');
    }
  }, 'image/png');
});

$('btn-mk-download').addEventListener('click', () => {
  if (!lastQrDataUrl) return;
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  chrome.downloads.download({ url: lastQrDataUrl, filename: 'qrcode-' + ts + '.png', saveAs: false });
});

/* ------------------------------------------------------------------ */
/* 初始化                                                             */
/* ------------------------------------------------------------------ */
(async function init() {
  renderHistory();
  try {
    const { lastResult } = await chrome.storage.session.get('lastResult');
    if (lastResult && lastResult.text) {
      showResult(lastResult.text, lastResult.from || '上次识别');
    }
  } catch (e) { /* ignore */ }
  $('mk-text').value = '';
  renderQR();
})();
