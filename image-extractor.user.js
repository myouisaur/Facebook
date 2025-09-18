// ==UserScript==
// @name         [Facebook] Media Extractor
// @namespace    https://github.com/myouisaur/Facebook
// @icon         https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico
// @version      2.5
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
    .xiv-fb-photo-btn-container,
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
    .xiv-fb-btn:hover {
      transform: scale(1.05);
    }
    .xiv-fb-btn:active {
      transform: scale(0.95);
      opacity: 0.9;
    }

    /* --- Smooth hover effect (fast fade in, slower fade out) --- */
    .xiv-fb-photo-btn-container {
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease; /* slower fade out */
    }
    .xiv-fb-photo-btn-container.xiv-visible {
      opacity: 1 !important;
      pointer-events: auto !important;
      transition: opacity 0.15s ease; /* faster fade in */
    }

    /* Stories: always visible */
    .xiv-fb-story-btn-container {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
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

  // Get highest-res URL (retry if Facebook is serving preview quality)
  function getHighResUrl(img, retries = 5) {
    return new Promise((resolve) => {
      let attempts = 0;
      function check() {
        const url = img.src;
        if (url && !url.includes("safe_image") && !url.includes("preview") && url.includes("fbcdn.net")) {
          resolve(url);
        } else if (attempts < retries) {
          attempts++;
          setTimeout(check, 400); // retry after 400ms
        } else {
          resolve(url); // fallback: whatever is available
        }
      }
      check();
    });
  }

  // Download function: keep JPG/JPEG originals, convert others at 0.92
  function downloadImage(url, filename) {
    if (/\.(jpg|jpeg)$/i.test(filename)) {
      return fetch(url)
        .then(r => r.ok ? r.blob() : Promise.reject())
        .then(blob => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(a.href);
        })
        .catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
    }

    // Convert PNG/WEBP → JPG
    if (/\.(png|webp)$/i.test(filename)) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(function (blob) {
          if (blob) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename.replace(/\.(png|webp)$/i, '.jpg');
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(a.href);
          } else {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        }, 'image/jpeg', 0.92);
      };
      img.onerror = () => window.open(url, '_blank', 'noopener,noreferrer');
      img.src = url;
      return;
    }

    // Fallback
    fetch(url)
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
  }

  // ---------- Hover helpers ----------
  function attachSmoothHover(parent, container) {
    if (parent.dataset.xivHoverAttached) return;
    parent.dataset.xivHoverAttached = '1';

    const show = () => container.classList.add('xiv-visible');
    const hide = () => container.classList.remove('xiv-visible');

    // Show buttons when hovering photo OR buttons
    parent.addEventListener('mouseenter', show, { passive: true });
    container.addEventListener('mouseenter', show, { passive: true });

    // Only hide when leaving the photo area (not when leaving buttons)
    parent.addEventListener('mouseleave', hide, { passive: true });
  }

  // ---------- Buttons ----------
  function addButtons(imgEl, filename, isStory = false) {
    if (!imgEl || processedElements.has(imgEl)) return;
    const parent = imgEl.parentElement;
    if (!parent) return;

    if (!isStory && !parent.classList.contains('show-buttons-parent')) {
      parent.classList.add('show-buttons-parent');
    }

    const container = document.createElement('div');
    container.className = isStory ? 'xiv-fb-story-btn-container' : 'xiv-fb-photo-btn-container';

    // Open button
    const openBtn = document.createElement('div');
    openBtn.className = 'xiv-fb-btn';
    openBtn.textContent = '🔗';
    openBtn.title = 'Open image in new tab';
    openBtn.onmousedown = async e => {
      e.stopPropagation(); e.preventDefault();
      const url = await getHighResUrl(imgEl);
      window.open(url, '_blank');
    };

    // Download button
    const dlBtn = document.createElement('div');
    dlBtn.className = 'xiv-fb-btn';
    dlBtn.textContent = '⬇';
    dlBtn.title = 'Download image';
    dlBtn.onmousedown = async e => {
      e.stopPropagation(); e.preventDefault();
      const url = await getHighResUrl(imgEl);
      downloadImage(url, filename);
    };

    container.appendChild(openBtn);
    container.appendChild(dlBtn);

    if (imgEl.nextSibling) parent.insertBefore(container, imgEl.nextSibling);
    else parent.appendChild(container);

    if (!isStory) {
      attachSmoothHover(parent, container);
    } else {
      container.classList.add('xiv-visible');
    }

    processedElements.add(imgEl);
  }

  // ---------- Injectors ----------
  function injectPhotoDialog() {
    if (!/\/photo/.test(location.pathname)) return;
    document.querySelectorAll('div[role="dialog"] img[src*="fbcdn.net"]').forEach(img => {
      if (!isLargeEnough(img)) return;
      const resolution = getResolution(img);
      const url = img.src;
      const ext = url.includes('.png') ? 'png' : url.includes('.webp') ? 'webp' : url.includes('.jpeg') ? 'jpeg' : 'jpg';
      addButtons(img, `fb-photo-${resolution}-${genRandom()}.${ext}`, false);
    });
  }

  function injectStoryDialog() {
    if (!/\/stories\//.test(location.pathname)) return;
    document.querySelectorAll('div[role="dialog"] img[src*="fbcdn.net"]').forEach(img => {
      if (!isLargeEnough(img)) return;
      const resolution = getResolution(img);
      const url = img.src;
      const ext = url.includes('.png') ? 'png' : url.includes('.webp') ? 'webp' : url.includes('.jpeg') ? 'jpeg' : 'jpg';
      addButtons(img, `fb-story-${resolution}-${genRandom()}.${ext}`, true);
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
    attributeFilter: ['src']
  });

})();
