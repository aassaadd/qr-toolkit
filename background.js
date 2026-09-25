/**
 * background.js —— MV3 Service Worker
 * 职责：右键菜单、区域截屏、跨域图片抓取、结果中转与存储、快捷键
 */
'use strict';

const MENU_SCAN_IMAGE = 'qr-scan-image';
const MENU_SCAN_REGION = 'qr-scan-region';
const MENU_SCAN_PAGE = 'qr-scan-page';

const CONTENT_FILES = ['lib/jsQR.js', 'lib/decode.js', 'content.js'];

/* ------------------------------------------------------------------ */
/* 安装 / 菜单                                                         */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SCAN_IMAGE,
      title: '识别这张图片里的二维码',
      contexts: ['image']
    });
    chrome.contextMenus.create({
      id: MENU_SCAN_REGION,
      title: '框选区域识别二维码',
      contexts: ['page', 'image', 'link', 'selection']
    });
    chrome.contextMenus.create({
      id: MENU_SCAN_PAGE,
      title: '扫描本页所有图片中的二维码',
      contexts: ['page', 'image']
    });
  });
  chrome.action.setBadgeBackgroundColor({ color: '#2F6BFF' });
});

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

function arrayBufferToDataUrl(buffer, mime) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return 'data:' + (mime || 'image/png') + ';base64,' + btoa(binary);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isInjectable(url) {
  if (!url) return false;
  return !/^(chrome|edge|about|devtools|chrome-extension|edge-extension|view-source|data):/i.test(url) &&
    !/^https?:\/\/(chromewebstore\.google\.com|microsoftedge\.microsoft\.com)/i.test(url);
}

/** 确保目标页面已注入内容脚本，返回是否可用 */
async function ensureContentScript(tabId, url) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    if (pong && pong.ok) return true;
  } catch (e) { /* 未注入 */ }

  if (!isInjectable(url)) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_FILES
    });
    return true;
  } catch (e) {
    console.warn('[QR] 注入内容脚本失败:', e && e.message);
    return false;
  }
}

async function flashBadge(text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: color || '#2F6BFF' });
    await chrome.action.setBadgeText({ text: String(text || '').slice(0, 4) });
    if (text) setTimeout(() => chrome.action.setBadgeText({ text: '' }).catch(() => {}), 2600);
  } catch (e) { /* ignore */ }
}

async function saveResult(text, from) {
  if (!text) return;
  const record = { text, from: from || '', at: Date.now() };
  try {
    await chrome.storage.session.set({ lastResult: record });
    const { history = [] } = await chrome.storage.local.get('history');
    const next = [record].concat(history.filter((h) => h.text !== text)).slice(0, 30);
    await chrome.storage.local.set({ history: next });
  } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* 右键菜单 / 快捷键                                                   */
/* ------------------------------------------------------------------ */

async function runOnActiveTab(action) {
  const tab = await getActiveTab();
  if (!tab || tab.id == null) return;
  const ok = await ensureContentScript(tab.id, tab.url);
  if (!ok) {
    await flashBadge('×', '#E5484D');
    await chrome.action.setTitle({ tabId: tab.id, title: '当前页面不允许注入脚本（浏览器内置页面/扩展商店页）' });
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: action });
  } catch (e) {
    console.warn('[QR] 消息发送失败:', e && e.message);
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || tab.id == null) return;
  if (info.menuItemId === MENU_SCAN_REGION) {
    await runOnActiveTab('startSelect');
    return;
  }

  const ok = await ensureContentScript(tab.id, tab.url);
  if (!ok) {
    await flashBadge('×', '#E5484D');
    return;
  }

  if (info.menuItemId === MENU_SCAN_IMAGE) {
    if (!info.srcUrl) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'scanImage', url: info.srcUrl });
    } catch (e) { console.warn(e); }
  } else if (info.menuItemId === MENU_SCAN_PAGE) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'scanPage' });
    } catch (e) { console.warn(e); }
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'scan-region') runOnActiveTab('startSelect');
});

/* ------------------------------------------------------------------ */
/* 消息路由                                                            */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    /* 弹窗请求：对当前标签页进行区域框选识别 */
    case 'ui:startSelect': {
      runOnActiveTab('startSelect').then(() => sendResponse({ ok: true }));
      return true;
    }

    /* 弹窗请求：整页（当前可视区域）识别 */
    case 'ui:captureViewport':
    case 'captureVisible': {
      capture(sender).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    /* 内容脚本请求：抓取跨域图片，转成 dataURL 回传（绕过页面 CORS 限制） */
    case 'fetchImage': {
      fetchAsDataUrl(msg.url).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    /* 保存 / 读取识别结果 */
    case 'saveResult': {
      saveResult(msg.text, msg.from).then(() => sendResponse({ ok: true }));
      return true;
    }

    /* 徽标反馈 */
    case 'badge': {
      flashBadge(msg.text, msg.color).then(() => sendResponse({ ok: true }));
      return true;
    }

    /* 复制兜底：内容脚本/弹窗调用（保证在任意页面都能复制） */
    case 'copyText': {
      // MV3 中这里仅作为占位，实际复制由发起方完成
      sendResponse({ ok: false, error: 'use-clipboard-api' });
      return true;
    }

    default:
      return;
  }
});

async function capture(sender) {
  let windowId;
  if (sender && sender.tab && sender.tab.windowId != null) {
    windowId = sender.tab.windowId;
  } else {
    const tab = await getActiveTab();
    if (!tab) throw new Error('未找到活动标签页');
    windowId = tab.windowId;
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  return { ok: true, dataUrl };
}

async function fetchAsDataUrl(url) {
  if (!url) throw new Error('缺少图片地址');
  if (/^data:/i.test(url)) return { ok: true, dataUrl: url };
  const res = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
  if (!res.ok) throw new Error('下载图片失败 HTTP ' + res.status);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 12 * 1024 * 1024) throw new Error('图片过大（>12MB），已跳过');
  const mime = (res.headers.get('content-type') || 'image/png').split(';')[0];
  return { ok: true, dataUrl: arrayBufferToDataUrl(buf, mime) };
}
