/**
 * content.js —— 页面内容脚本
 * 提供：区域框选识别、页面图片识别、页内结果卡片（含一键复制）
 * 依赖：lib/jsQR.js、lib/decode.js
 */
(function () {
  'use strict';

  if (window.__QR_TOOLKIT_LOADED__) return;
  window.__QR_TOOLKIT_LOADED__ = true;

  var Z = 2147483000;
  var panelId = 'qrt-panel-' + Math.random().toString(36).slice(2);

  /* ------------------------------------------------------------------ */
  /* 样式                                                               */
  /* ------------------------------------------------------------------ */
  function injectStyle() {
    if (document.getElementById('qrt-style')) return;
    var st = document.createElement('style');
    st.id = 'qrt-style';
    st.textContent = [
      '.qrt-overlay{position:fixed;inset:0;z-index:' + (Z + 2) + ';background:rgba(15,23,42,.42);cursor:crosshair;user-select:none;}',
      '.qrt-tip{position:absolute;left:50%;top:22px;transform:translateX(-50%);background:#0f172a;color:#fff;',
      'font:13px/1.6 "Microsoft YaHei",system-ui,sans-serif;padding:8px 16px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.35);white-space:nowrap;}',
      '.qrt-tip b{color:#7db4ff;}',
      '.qrt-sel{position:absolute;border:2px solid #2f6bff;background:rgba(47,107,255,.14);box-shadow:0 0 0 9999px rgba(15,23,42,.42);border-radius:4px;}',
      '.qrt-hint{position:absolute;left:0;top:-24px;font:12px/1 "Microsoft YaHei",system-ui,sans-serif;color:#fff;background:#2f6bff;padding:4px 8px;border-radius:6px;white-space:nowrap;}',

      '.qrt-panel{position:fixed;right:20px;bottom:20px;width:340px;max-width:calc(100vw - 40px);z-index:' + (Z + 3) + ';',
      'background:#fff;border:1px solid #e3e8ef;border-radius:14px;box-shadow:0 18px 48px rgba(15,23,42,.22);',
      'font:13px/1.65 "Microsoft YaHei",system-ui,-apple-system,sans-serif;color:#1f2937;overflow:hidden;}',
      '.qrt-panel-hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(180deg,#f8faff,#f2f6ff);border-bottom:1px solid #e8eef8;}',
      '.qrt-panel-hd .qrt-title{font-weight:600;color:#111827;flex:1;}',
      '.qrt-chip{font-size:11px;padding:2px 8px;border-radius:999px;background:#e8f0ff;color:#2f6bff;font-weight:600;}',
      '.qrt-close{border:0;background:transparent;color:#94a3b8;font-size:18px;line-height:1;cursor:pointer;padding:0 2px;}',
      '.qrt-close:hover{color:#475569;}',
      '.qrt-body{padding:12px;max-height:190px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:13px;color:#0f172a;}',
      '.qrt-meta{padding:0 12px 10px;font-size:12px;color:#64748b;}',
      '.qrt-foot{display:flex;gap:8px;padding:0 12px 12px;}',
      '.qrt-btn{flex:1;border:1px solid #d8e1f0;background:#fff;color:#1f2937;border-radius:9px;padding:8px 10px;font-size:12.5px;',
      'cursor:pointer;font-family:inherit;}',
      '.qrt-btn:hover{background:#f5f8ff;border-color:#b9cdf5;}',
      '.qrt-btn.primary{background:#2f6bff;border-color:#2f6bff;color:#fff;font-weight:600;}',
      '.qrt-btn.primary:hover{background:#2559e0;}',
      '.qrt-loading{display:flex;align-items:center;gap:8px;color:#475569;}',
      '.qrt-spin{width:14px;height:14px;border:2px solid #d6e0f5;border-top-color:#2f6bff;border-radius:50%;animation:qrt-spin .7s linear infinite;}',
      '@keyframes qrt-spin{to{transform:rotate(360deg)}}',
      '.qrt-toast{position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:' + (Z + 3) + ';background:#0f172a;color:#fff;',
      'font:13px/1.6 "Microsoft YaHei",system-ui,sans-serif;padding:9px 16px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.3);}',
      '.qrt-list{display:flex;flex-direction:column;gap:6px;}',
      '.qrt-item{text-align:left;border:1px solid #e5eaf2;background:#fbfcff;border-radius:8px;padding:7px 9px;font-size:12px;',
      'color:#0f172a;cursor:pointer;word-break:break-all;font-family:inherit;}',
      '.qrt-item:hover{border-color:#b9cdf5;background:#f3f7ff;}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  /* ------------------------------------------------------------------ */
  /* 通用工具                                                           */
  /* ------------------------------------------------------------------ */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(
          function () { resolve(true); },
          function () { resolve(legacyCopy(text)); }
        );
      } else {
        resolve(legacyCopy(text));
      }
    });
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function flash(text) {
    var t = el('div', 'qrt-toast', text);
    document.documentElement.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  function removePanel() {
    var p = document.getElementById(panelId);
    if (p) p.remove();
  }

  function tell(msg) {
    try { chrome.runtime.sendMessage(msg, function () { void chrome.runtime.lastError; }); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* 结果卡片                                                           */
  /* ------------------------------------------------------------------ */
  function showPanel(result, opts) {
    opts = opts || {};
    injectStyle();
    removePanel();

    var text = result.text;
    var info = window.QRToolDecode.classify(text);

    var panel = el('div', 'qrt-panel');
    panel.id = panelId;

    var hd = el('div', 'qrt-panel-hd');
    hd.appendChild(el('span', 'qrt-title', '识别结果'));
    hd.appendChild(el('span', 'qrt-chip', info.label));
    var close = el('button', 'qrt-close', '×');
    close.title = '关闭';
    close.addEventListener('click', removePanel);
    hd.appendChild(close);
    panel.appendChild(hd);

    var body = el('div', 'qrt-body', text);
    panel.appendChild(body);

    if (info.note) panel.appendChild(el('div', 'qrt-meta', info.note));
    if (opts.from) panel.appendChild(el('div', 'qrt-meta', '来源：' + opts.from + '　' + text.length + ' 字符'));

    var foot = el('div', 'qrt-foot');
    var btnCopy = el('button', 'qrt-btn primary', '一键复制');
    btnCopy.addEventListener('click', function () {
      copyText(text).then(function (ok) {
        btnCopy.textContent = ok ? '已复制 ✓' : '复制失败';
        setTimeout(function () { btnCopy.textContent = '一键复制'; }, 1500);
      });
    });
    foot.appendChild(btnCopy);

    if (info.kind === 'url' || info.url) {
      var btnOpen = el('button', 'qrt-btn', '打开链接');
      btnOpen.addEventListener('click', function () {
        window.open(info.url, '_blank', 'noopener');
      });
      foot.appendChild(btnOpen);
    }

    var btnAgain = el('button', 'qrt-btn', '重新框选');
    btnAgain.addEventListener('click', function () {
      removePanel();
      startSelect();
    });
    foot.appendChild(btnAgain);

    panel.appendChild(foot);
    document.documentElement.appendChild(panel);

    tell({ type: 'saveResult', text: text, from: opts.from || '' });
    tell({ type: 'badge', text: '✓', color: '#12A150' });
  }

  function showError(message) {
    injectStyle();
    removePanel();
    var panel = el('div', 'qrt-panel');
    panel.id = panelId;
    var hd = el('div', 'qrt-panel-hd');
    hd.appendChild(el('span', 'qrt-title', '识别失败'));
    var close = el('button', 'qrt-close', '×');
    close.addEventListener('click', removePanel);
    hd.appendChild(close);
    panel.appendChild(hd);
    panel.appendChild(el('div', 'qrt-body', message || '未在所选区域找到二维码'));
    var foot = el('div', 'qrt-foot');
    var btnAgain = el('button', 'qrt-btn primary', '重新框选');
    btnAgain.addEventListener('click', function () { removePanel(); startSelect(); });
    foot.appendChild(btnAgain);
    panel.appendChild(foot);
    document.documentElement.appendChild(panel);
    tell({ type: 'badge', text: '×', color: '#E5484D' });
  }

  function showLoading(message) {
    injectStyle();
    removePanel();
    var panel = el('div', 'qrt-panel');
    panel.id = panelId;
    var hd = el('div', 'qrt-panel-hd');
    hd.appendChild(el('span', 'qrt-title', message || '识别中…'));
    panel.appendChild(hd);
    var body = el('div', 'qrt-body');
    var wrap = el('div', 'qrt-loading');
    wrap.appendChild(el('div', 'qrt-spin'));
    wrap.appendChild(el('span', null, '正在解析二维码，请稍候'));
    body.appendChild(wrap);
    panel.appendChild(body);
    document.documentElement.appendChild(panel);
  }

  function showList(title, items) {
    injectStyle();
    removePanel();
    var panel = el('div', 'qrt-panel');
    panel.id = panelId;
    var hd = el('div', 'qrt-panel-hd');
    hd.appendChild(el('span', 'qrt-title', title));
    var close = el('button', 'qrt-close', '×');
    close.addEventListener('click', removePanel);
    hd.appendChild(close);
    panel.appendChild(hd);

    var body = el('div', 'qrt-body');
    var list = el('div', 'qrt-list');
    items.forEach(function (it) {
      var b = el('button', 'qrt-item', it);
      b.title = '点击复制';
      b.addEventListener('click', function () {
        copyText(it).then(function (ok) {
          b.textContent = ok ? '已复制：' + it : '复制失败';
        });
      });
      list.appendChild(b);
    });
    body.appendChild(list);
    panel.appendChild(body);
    var foot = el('div', 'qrt-foot');
    var btn = el('button', 'qrt-btn primary', '全部复制');
    btn.addEventListener('click', function () {
      copyText(items.join('\n')).then(function (ok) {
        btn.textContent = ok ? '已复制 ✓' : '复制失败';
        setTimeout(function () { btn.textContent = '全部复制'; }, 1500);
      });
    });
    foot.appendChild(btn);
    panel.appendChild(foot);
    document.documentElement.appendChild(panel);
  }

  /* ------------------------------------------------------------------ */
  /* 区域框选识别                                                       */
  /* ------------------------------------------------------------------ */
  var selecting = false;

  function startSelect() {
    if (selecting) return;
    selecting = true;
    injectStyle();
    removePanel();

    var overlay = el('div', 'qrt-overlay');
    var tip = el('div', 'qrt-tip');
    tip.innerHTML = '拖动鼠标框选二维码区域　·　<b>Esc</b> 取消';
    overlay.appendChild(tip);

    var sel = null, hint = null, startX = 0, startY = 0, dragging = false;

    function onDown(e) {
      if (e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      sel = el('div', 'qrt-sel');
      hint = el('div', 'qrt-hint', '');
      sel.appendChild(hint);
      overlay.appendChild(sel);
      update(e);
      overlay.addEventListener('mousemove', update);
      e.preventDefault();
    }

    function update(e) {
      if (!dragging) return;
      var x = Math.min(startX, e.clientX), y = Math.min(startY, e.clientY);
      var w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
      sel.style.left = x + 'px';
      sel.style.top = y + 'px';
      sel.style.width = w + 'px';
      sel.style.height = h + 'px';
      hint.textContent = Math.round(w) + ' × ' + Math.round(h);
    }

    function cleanup() {
      selecting = false;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mouseup', onUp, true);
      overlay.removeEventListener('mousedown', onDown, true);
      overlay.removeEventListener('mousemove', update);
      overlay.remove();
    }

    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      overlay.removeEventListener('mousemove', update);

      var rect = {
        x: Math.min(startX, e.clientX),
        y: Math.min(startY, e.clientY),
        width: Math.abs(e.clientX - startX),
        height: Math.abs(e.clientY - startY)
      };
      cleanup();
      if (rect.width < 8 || rect.height < 8) {
        flash('选择区域太小，已取消');
        return;
      }
      showLoading('识别中…');
      captureAndDecode(rect);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        cleanup();
        flash('已取消');
      }
    }

    overlay.addEventListener('mousedown', onDown, true);
    document.addEventListener('mouseup', onUp, true);
    document.addEventListener('keydown', onKey, true);
    document.documentElement.appendChild(overlay);
  }

  /** 截屏 + 按框选区域裁剪 + 解码 */
  function captureAndDecode(rect) {
    var scaleX = 1, scaleY = 1;

    chrome.runtime.sendMessage({ type: 'captureVisible' }, function (res) {
      void chrome.runtime.lastError;
      if (!res || !res.ok || !res.dataUrl) {
        showError('截屏失败：' + ((res && res.error) || '未知错误'));
        return;
      }

      var img = new Image();
      img.onload = function () {
        // 用实际截图尺寸反推缩放比，兼容缩放/高 DPI 屏
        scaleX = img.naturalWidth / window.innerWidth;
        scaleY = img.naturalHeight / window.innerHeight;

        var crop = {
          x: Math.max(0, rect.x * scaleX),
          y: Math.max(0, rect.y * scaleY),
          width: rect.width * scaleX,
          height: rect.height * scaleY
        };

        var hit = null, canvas = null;
        try {
          canvas = window.QRToolDecode.drawToCanvas(img, 2600, crop);
          hit = window.QRToolDecode.decodeCanvas(canvas);
        } catch (e) {
          console.warn('[QR] 解码异常', e);
        }

        if (hit && hit.data) {
          showPanel({ text: hit.data }, { from: '屏幕框选' });
          flash('识别成功，已自动复制选项在卡片中');
          return;
        }

        // 兜底：整个可视区域再扫一次
        try {
          var full = window.QRToolDecode.drawToCanvas(img, 2600, null);
          var hit2 = window.QRToolDecode.decodeCanvas(full);
          if (hit2 && hit2.data) {
            showPanel({ text: hit2.data }, { from: '整页兜底识别' });
            return;
          }
        } catch (e) { /* ignore */ }

        showError('所选区域未识别到二维码，可放大二维码后重试，或换用「整页识别」/「上传图片」。');
      };
      img.onerror = function () { showError('截图解析失败'); };
      img.src = res.dataUrl;
    });
  }

  /* ------------------------------------------------------------------ */
  /* 图片 / 页面扫描                                                    */
  /* ------------------------------------------------------------------ */
  function drawableFromImg(img) {
    // 同源图片可直接绘制；跨域会抛 SecurityError
    var canvas = window.QRToolDecode.drawToCanvas(img, 2600, null);
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.getImageData(0, 0, 1, 1); // 触发污染检测
    return canvas;
  }

  function fetchViaBackground(url) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: 'fetchImage', url: url }, function (res) {
        void chrome.runtime.lastError;
        if (res && res.ok && res.dataUrl) resolve(res.dataUrl);
        else resolve(null);
      });
    });
  }

  function decodeImgElement(img) {
    try {
      var canvas = drawableFromImg(img);
      var hit = window.QRToolDecode.decodeCanvas(canvas);
      if (hit && hit.data) return Promise.resolve(hit.data);
    } catch (e) { /* 跨域污染，走后台抓取 */ }

    var url = img.currentSrc || img.src;
    if (!url) return Promise.resolve(null);
    return fetchViaBackground(url).then(function (dataUrl) {
      if (!dataUrl) return null;
      return window.QRToolDecode.decodeDataURL(dataUrl).then(function (hit) {
        return hit && hit.data ? hit.data : null;
      }).catch(function () { return null; });
    });
  }

  function scanImageByUrl(url) {
    var imgs = Array.prototype.slice.call(document.images || []);
    var target = imgs.find(function (im) {
      return im.currentSrc === url || im.src === url;
    });
    showLoading('识别图片中…');
    var p = target
      ? decodeImgElement(target)
      : fetchViaBackground(url).then(function (d) {
          if (!d) return null;
          return window.QRToolDecode.decodeDataURL(d).then(function (h) { return h && h.data ? h.data : null; })
            .catch(function () { return null; });
        });
    p.then(function (text) {
      if (text) showPanel({ text: text }, { from: '右键图片' });
      else showError('这张图片里没有识别到二维码。');
    });
  }

  function scanPage() {
    var imgs = Array.prototype.slice.call(document.images || []).filter(function (im) {
      return (im.naturalWidth || 0) >= 40 && (im.naturalHeight || 0) >= 40;
    });
    if (!imgs.length) { flash('当前页面没有可扫描的图片'); return; }

    var limit = Math.min(imgs.length, 40);
    showLoading('扫描页面图片 0/' + limit + '…');
    var found = [];
    var i = 0;

    function step() {
      if (i >= limit) {
        if (found.length === 1) showPanel({ text: found[0] }, { from: '页面图片 ×' + limit });
        else if (found.length > 1) showList('找到 ' + found.length + ' 个二维码（点击复制）', found);
        else showError('扫描了 ' + limit + ' 张图片，未发现二维码。');
        tell({ type: 'badge', text: found.length ? String(found.length) : '0', color: found.length ? '#12A150' : '#E5484D' });
        return;
      }
      var panel = document.getElementById(panelId);
      var body = panel && panel.querySelector('.qrt-body span');
      if (body) body.textContent = '正在解析图片 ' + (i + 1) + '/' + limit + '…';
      else showLoading('扫描页面图片 ' + (i + 1) + '/' + limit + '…');

      decodeImgElement(imgs[i]).then(function (text) {
        if (text && found.indexOf(text) === -1) found.push(text);
        i++;
        setTimeout(step, 10);
      }).catch(function () {
        i++;
        setTimeout(step, 10);
      });
    }
    step();
  }

  /* ------------------------------------------------------------------ */
  /* 消息入口                                                           */
  /* ------------------------------------------------------------------ */
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'ping':
        sendResponse({ ok: true });
        return;
      case 'startSelect':
        startSelect();
        sendResponse({ ok: true });
        return;
      case 'scanImage':
        scanImageByUrl(msg.url);
        sendResponse({ ok: true });
        return;
      case 'scanPage':
        scanPage();
        sendResponse({ ok: true });
        return;
      default:
        return;
    }
  });
})();
