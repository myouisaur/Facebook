// ==UserScript==
// @name         [Facebook] Media Extractor
// @namespace    https://github.com/myouisaur/Facebook
// @icon         https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico
// @version      1.14
// @description  Adds open + download buttons to Facebook images when viewing /photo or /stories.
// @author       Xiv
// @match        *://*.facebook.com/*
// @grant        GM_addStyle
// @updateURL    https://myouisaur.github.io/Facebook/image-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Facebook/image-extractor.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Styling ----------
  GM_addStyle(`
    .xiv-fb-photo-btn-container {
      position: absolute !important;
      bottom: 14px;
      left: 50%;
      transform: translateX(-50%);
      display: flex !important;
      gap: 6px;
      z-index: 999999 !important;
      opacity: 1;
      pointer-events: auto;
    }

    .xiv-fb-story-btn-container {
      position: absolute !important;
      bottom: 14px;
      left: 50%;
      transform: translateX(-50%);
      display: flex !important;
      gap: 6px;
      z-index: 999999 !important;
      opacity: 1;
      pointer-events: auto;
    }

    .xiv-fb-btn {
      width: 36px;
      height: 36px;
      background: rgba(0,0,0,0.4);
      backdrop-filter: blur(6px);
      color: white;
      border-radius: 10px;
      cursor: pointer;
      border: 1px solid rgba(255,255,255,0.1);
      display: flex !important;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.2);
      transition: transform 0.12s ease, opacity 0.12s ease;
    }
    .xiv-fb-btn:hover { transform: scale(1.06); }
    .xiv-fb-btn:active { transform: scale(0.98); opacity: 0.9; }
  `);

  // ---------- Helpers ----------
  const processedElements = new WeakSet();
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  function genRandom(len = 15) {
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
  function isLargeEnough(el) {
    const w = el.naturalWidth || el.offsetWidth || 0;
    const h = el.naturalHeight || el.offsetHeight || 0;
    return w >= 200 && h >= 200;
  }
  function getResolution(el) {
    const w = el.naturalWidth || el.offsetWidth || 0;
    const h = el.naturalHeight || el.offsetHeight || 0;
    return `${w}x${h}`;
  }
  function downloadImage(url, filename) {
    // Convert to highest quality JPG before downloading
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Handle CORS

    img.onload = function() {
      // Create canvas for conversion
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Set canvas size to image size
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;

      // Fill white background (for transparency conversion)
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw image on canvas
      ctx.drawImage(img, 0, 0);

      // Convert to highest quality JPG
      canvas.toBlob(function(blob) {
        if (blob) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename.replace(/\.(png|webp|jpg|jpeg)$/i, '.jpg');
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(a.href);
        } else {
          // Fallback to original method
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      }, 'image/jpeg', 1.0); // 1.0 = highest quality
    };

    img.onerror = function() {
      // Fallback to original download method
      fetch(url)
        .then(r => r.ok ? r.blob() : Promise.reject())
        .then(blob => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename || `fb-img-${genRandom(15)}.jpg`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(a.href);
        })
        .catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
    };

    // Start loading image
    img.src = url;
  }

  // ---------- Photo Buttons ----------
  function addPhotoButtons(imgEl, url, filename) {
    if (!imgEl || processedElements.has(imgEl)) return;

    const parent = imgEl.parentElement;
    if (!parent) return;

    const container = document.createElement('div');
    container.className = 'xiv-fb-photo-btn-container';

    const openBtn = document.createElement('div');
    openBtn.className = 'xiv-fb-btn';
    openBtn.textContent = '🔗';
    openBtn.title = 'Open image in new tab';
    openBtn.onmousedown = e => { e.stopPropagation(); e.preventDefault(); window.open(url, '_blank'); };

    const dlBtn = document.createElement('div');
    dlBtn.className = 'xiv-fb-btn';
    dlBtn.textContent = '⬇';
    dlBtn.title = 'Download image';
    dlBtn.onmousedown = e => { e.stopPropagation(); e.preventDefault(); downloadImage(url, filename); };

    container.appendChild(openBtn);
    container.appendChild(dlBtn);

    if (imgEl.nextSibling) parent.insertBefore(container, imgEl.nextSibling);
    else parent.appendChild(container);

    processedElements.add(imgEl);
  }

  // ---------- Story Buttons ----------
  function addStoryButtons(imgEl, url, filename) {
    if (!imgEl || processedElements.has(imgEl)) return;

    const parent = imgEl.parentElement;
    if (!parent) return;

    const container = document.createElement('div');
    container.className = 'xiv-fb-story-btn-container';

    const openBtn = document.createElement('div');
    openBtn.className = 'xiv-fb-btn';
    openBtn.textContent = '🔗';
    openBtn.title = 'Open image in new tab';
    openBtn.onmousedown = e => { e.stopPropagation(); e.preventDefault(); window.open(url, '_blank'); };

    const dlBtn = document.createElement('div');
    dlBtn.className = 'xiv-fb-btn';
    dlBtn.textContent = '⬇';
    dlBtn.title = 'Download image';
    dlBtn.onmousedown = e => { e.stopPropagation(); e.preventDefault(); downloadImage(url, filename); };

    container.appendChild(openBtn);
    container.appendChild(dlBtn);

    if (imgEl.nextSibling) parent.insertBefore(container, imgEl.nextSibling);
    else parent.appendChild(container);

    processedElements.add(imgEl);
  }

  // ---------- Injectors ----------
  function injectPhotoDialog() {
    if (!/\/photo/.test(location.pathname)) return;
    document.querySelectorAll('div[role="dialog"] img[src*="fbcdn.net"]').forEach(img => {
      if (!isLargeEnough(img)) return;
      const url = img.src;
      const resolution = getResolution(img);
      const ext = url.includes('.png') ? 'png' : url.includes('.webp') ? 'webp' : 'jpg';
      addPhotoButtons(img, url, `fb-photo-${resolution}-${genRandom()}.${ext}`);
    });
  }

  function injectStoryDialog() {
    if (!/\/stories\//.test(location.pathname)) return;
    document.querySelectorAll('div[role="dialog"] img[src*="fbcdn.net"]').forEach(img => {
      if (!isLargeEnough(img)) return;
      const url = img.src;
      const resolution = getResolution(img);
      const ext = url.includes('.png') ? 'png' : url.includes('.webp') ? 'webp' : 'jpg';
      addStoryButtons(img, url, `fb-story-${resolution}-${genRandom()}.${ext}`);
    });
  }

  // ---------- Observer ----------
  const observer = new MutationObserver(() => {
    injectPhotoDialog();
    injectStoryDialog();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'] // react to story img src changes
  });

})();
