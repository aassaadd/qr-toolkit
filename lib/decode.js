/**
 * decode.js —— 二维码解码工具（弹窗页 / 内容脚本共用）
 * 依赖：lib/jsQR.js（全局 jsQR）
 * 多轮尝试策略：原图 → 二值化 → 2 倍放大 → 3 倍放大，显著提升小尺寸/低对比度二维码的识别率。
 */
(function () {
  'use strict';

  var MAX_SIDE = 2600;      // 超大图先等比缩到该边长，避免卡死
  var MAX_PIXELS_UPSCALE = 4.2e6; // 像素过多时跳过放大尝试

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function ctxOf(canvas) {
    try {
      return canvas.getContext('2d', { willReadFrequently: true });
    } catch (e) {
      return canvas.getContext('2d');
    }
  }

  function scan(imageData) {
    if (typeof jsQR !== 'function') return null;
    try {
      return jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });
    } catch (e) {
      return null;
    }
  }

  /** 二值化：按 Otsu 思想取近似阈值，提升低对比度图片的可读性 */
  function binarize(imageData) {
    var d = imageData.data;
    var len = d.length;
    var hist = new Array(256).fill(0);
    for (var i = 0; i < len; i += 4) {
      var g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = d[i + 1] = d[i + 2] = g;
      hist[g]++;
    }
    var total = len / 4, sum = 0;
    for (var t = 0; t < 256; t++) sum += t * hist[t];
    var sumB = 0, wB = 0, max = 0, thres = 128;
    for (var k = 0; k < 256; k++) {
      wB += hist[k];
      if (wB === 0) continue;
      var wF = total - wB;
      if (wF === 0) break;
      sumB += k * hist[k];
      var mB = sumB / wB;
      var mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > max) { max = between; thres = k; }
    }
    for (var j = 0; j < len; j += 4) {
      var v = d[j] > thres ? 255 : 0;
      d[j] = d[j + 1] = d[j + 2] = v;
    }
    return imageData;
  }

  function rescale(canvas, scale) {
    var out = makeCanvas(canvas.width * scale, canvas.height * scale);
    var c = ctxOf(out);
    c.imageSmoothingEnabled = false;
    c.drawImage(canvas, 0, 0, out.width, out.height);
    return out;
  }

  /** 核心：对任意 canvas 做多轮识别 */
  function decodeCanvas(canvas) {
    if (!canvas || !canvas.width || !canvas.height) return null;

    var ctx = ctxOf(canvas);
    var pixels = canvas.width * canvas.height;

    // 第 1 轮：原图
    var id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var hit = scan(id);
    if (hit) return hit;

    // 第 2 轮：二值化（复制一份，避免污染原数据）
    try {
      var copy = new ImageData(new Uint8ClampedArray(id.data), id.width, id.height);
      hit = scan(binarize(copy));
      if (hit) return hit;
    } catch (e) { /* ImageData 构造函数不可用时忽略 */ }

    // 第 3/4 轮：放大后再试（小二维码、截图区域偏小时有效）
    if (pixels <= MAX_PIXELS_UPSCALE) {
      var scales = [2, 3];
      for (var i = 0; i < scales.length; i++) {
        try {
          var up = rescale(canvas, scales[i]);
          var upId = ctxOf(up).getImageData(0, 0, up.width, up.height);
          hit = scan(upId);
          if (hit) return hit;
          var upCopy = new ImageData(new Uint8ClampedArray(upId.data), upId.width, upId.height);
          hit = scan(binarize(upCopy));
          if (hit) return hit;
        } catch (e) { /* 放大失败则跳过 */ }
      }
    }
    return null;
  }

  /** 把任意可绘制对象画入 canvas（会按 MAX_SIDE 等比缩小） */
  function drawToCanvas(src, maxSide, cropRect) {
    maxSide = maxSide || MAX_SIDE;
    var sw, sh;
    if (cropRect) {
      sw = cropRect.width; sh = cropRect.height;
    } else {
      sw = src.naturalWidth || src.width;
      sh = src.naturalHeight || src.height;
    }
    if (!sw || !sh) throw new Error('图片尺寸无效（可能尚未加载完成）');

    var ratio = Math.min(1, maxSide / Math.max(sw, sh));
    var canvas = makeCanvas(sw * ratio, sh * ratio);
    var c = ctxOf(canvas);
    if (cropRect) {
      c.drawImage(
        src,
        cropRect.x, cropRect.y, cropRect.width, cropRect.height,
        0, 0, canvas.width, canvas.height
      );
    } else {
      c.drawImage(src, 0, 0, canvas.width, canvas.height);
    }
    return canvas;
  }

  function loadImage(src, crossOrigin) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      if (crossOrigin) img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片加载失败')); };
      img.src = src;
    });
  }

  function decodeSource(src, cropRect) {
    return Promise.resolve()
      .then(function () {
        if (typeof createImageBitmap === 'function') {
          return createImageBitmap(src).catch(function () { return null; });
        }
        return null;
      })
      .then(function (bmp) {
        if (bmp) {
          var canvas = drawToCanvas(bmp, MAX_SIDE, cropRect);
          var hit = decodeCanvas(canvas);
          if (bmp.close) { try { bmp.close(); } catch (e) {} }
          return hit;
        }
        return loadImageSource(src, cropRect);
      });
  }

  function loadImageSource(src, cropRect) {
    if (typeof src === 'string') return loadImage(src).then(function (img) { return decodeCanvas(drawToCanvas(img, MAX_SIDE, cropRect)); });
    return decodeCanvas(drawToCanvas(src, MAX_SIDE, cropRect));
  }

  function decodeBlob(blob) {
    return decodeSource(blob);
  }

  function decodeDataURL(dataUrl) {
    return loadImage(dataUrl).then(function (img) {
      return decodeCanvas(drawToCanvas(img, MAX_SIDE));
    });
  }

  function decodeFile(file) {
    return decodeBlob(file);
  }

  /** 从解码结果解析出内容类型，便于界面展示与「打开链接」等动作 */
  function classify(text) {
    var t = (text || '').trim();
    if (/^https?:\/\//i.test(t)) return { kind: 'url', label: '网址', url: t };
    if (/^www\.[^\s]+\.[a-z]{2,}/i.test(t)) return { kind: 'url', label: '网址', url: 'http://' + t };
    if (/^WIFI:/i.test(t)) {
      var m = /S:([^;]*)/i.exec(t);
      return { kind: 'wifi', label: 'WiFi 配置', note: m ? ('网络：' + m[1]) : '' };
    }
    if (/^BEGIN:VCARD/i.test(t)) {
      var n = /FN:([^\r\n]*)/i.exec(t);
      return { kind: 'vcard', label: '名片', note: n ? ('姓名：' + n[1].trim()) : '' };
    }
    if (/^BEGIN:VEVENT/i.test(t)) return { kind: 'event', label: '日历事件' };
    if (/^mailto:/i.test(t)) return { kind: 'mailto', label: '邮箱', url: t };
    if (/^tel:/i.test(t)) return { kind: 'tel', label: '电话', url: t };
    if (/^smsto?:/i.test(t)) return { kind: 'sms', label: '短信', url: t };
    if (/^geo:/i.test(t)) return { kind: 'geo', label: '地理位置' };
    if (/^\d{12,}$/.test(t)) return { kind: 'barcode', label: '条码/数字串' };
    return { kind: 'text', label: '文本' };
  }

  window.QRToolDecode = {
    decodeCanvas: decodeCanvas,
    decodeBlob: decodeBlob,
    decodeDataURL: decodeDataURL,
    decodeFile: decodeFile,
    decodeSource: decodeSource,
    drawToCanvas: drawToCanvas,
    classify: classify,
    MAX_SIDE: MAX_SIDE
  };
})();
