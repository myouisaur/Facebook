// ==UserScript==
// @name         [Facebook] Media Extractor
// @namespace    https://github.com/myouisaur/Facebook
// @icon         https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico
// @version      3.6
// @description  Adds open and download buttons to Facebook images in photo and story views.
// @author       Xiv
// @match        *://*.facebook.com/*
// @noframes
// @grant        GM_addStyle
// @updateURL    https://myouisaur.github.io/Facebook/image-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Facebook/image-extractor.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ---------- Duplicate Execution Guard ----------
    if (window.__xivFbMediaExtractorRunning) return;
    window.__xivFbMediaExtractorRunning = true;

    // ---------- Configuration ----------
    const CONFIG = {
        selectors: {
            photoDialog: 'div[role="dialog"] img[src*="fbcdn.net"]',
            storyView: 'img[src*="fbcdn.net"]'
        },
        img: {
            minWidth: 200,
            minHeight: 200,
            retries: 5,
            pollIntervalMs: 400,
            jpegQuality: 1.0
        },
        ui: {
            debounceMs: 250,
            successDurationMs: 2000
        }
    };

    // ---------- State ----------
    const processedElements = new WeakSet();
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    // ---------- Icons (SVG Strings) ----------
    const ICONS = {
        download: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
        open: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`,
        spinner: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="xiv-spin" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>`,
        check: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    };

    // ---------- Styling ----------
    GM_addStyle(`
        .xiv-fb-btn-container {
            position: absolute !important;
            bottom: clamp(1rem, 2.5vw, 1.5rem);
            left: 50%;
            /* Hidden State: Shifted down and scaled slightly for a float-in entrance */
            transform: translateX(-50%) translateY(16px) scale(0.9);
            display: flex !important;
            gap: clamp(0.5rem, 1vw, 0.75rem);
            z-index: 999999 !important;
            opacity: 0;
            pointer-events: none;
            /* Springy easing creates a premium pop-up effect */
            transition: opacity 0.3s ease, transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }

        .xiv-photo-parent:hover .xiv-fb-btn-container {
            opacity: 1 !important;
            /* Visible State: Rests at baseline position */
            transform: translateX(-50%) translateY(0) scale(1) !important;
            pointer-events: auto !important;
        }

        .xiv-fb-btn-container.xiv-story-mode {
            opacity: 1 !important;
            pointer-events: auto !important;
            transform: translateX(-50%) translateY(0) scale(1);
            /* Stories use an explicit animation on load since they don't rely on hover */
            animation: xiv-mount-spring 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        }

        @keyframes xiv-mount-spring {
            0% {
                opacity: 0;
                transform: translateX(-50%) translateY(16px) scale(0.9);
            }
            100% {
                opacity: 1;
                transform: translateX(-50%) translateY(0) scale(1);
            }
        }

        .xiv-fb-btn {
            width: clamp(2.25rem, 4vw, 2.75rem);
            height: clamp(2.25rem, 4vw, 2.75rem);
            background: rgba(20, 20, 20, 0.6);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            color: #ffffff;
            border-radius: 50%;
            cursor: pointer;
            border: 1px solid rgba(255, 255, 255, 0.2);
            display: flex !important;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
            transition: transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), background-color 0.25s ease, border-color 0.25s ease;
        }

        .xiv-fb-btn svg {
            width: 50% !important;
            height: 50% !important;
            display: block !important;
            fill: none !important;
            overflow: visible !important;
        }

        .xiv-fb-btn:hover {
            transform: scale(1.08);
            background: rgba(20, 20, 20, 0.85);
            border-color: rgba(255, 255, 255, 0.4);
        }

        .xiv-fb-btn:active {
            transform: scale(0.96);
        }

        .xiv-fb-btn[data-loading="1"] {
            pointer-events: none;
            opacity: 0.8;
        }

        @keyframes xiv-spin {
            100% { transform: rotate(360deg); }
        }
        .xiv-spin {
            animation: xiv-spin 1s linear infinite;
        }
    `);

    // ---------- Core Utilities ----------
    function generateId(len = 12) {
        return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    }

    function createIconElement(svgString) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, 'image/svg+xml');
        return doc.documentElement;
    }

    function isElementSufficientSize(el) {
        const w = el.naturalWidth || el.offsetWidth || 0;
        const h = el.naturalHeight || el.offsetHeight || 0;
        return w >= CONFIG.img.minWidth && h >= CONFIG.img.minHeight;
    }

    function getResolutionString(el) {
        const w = el.naturalWidth || el.offsetWidth || 0;
        const h = el.naturalHeight || el.offsetHeight || 0;
        return `${w}x${h}`;
    }

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // ---------- Image Processing ----------
    function getHighResUrl(img) {
        return new Promise((resolve) => {
            let attempts = 0;
            function check() {
                if (!img.isConnected) {
                    return resolve(null);
                }

                const url = img.src;
                if (url && !url.includes("safe_image") && !url.includes("preview") && url.includes("fbcdn.net")) {
                    resolve(url);
                } else if (attempts < CONFIG.img.retries) {
                    attempts++;
                    setTimeout(check, CONFIG.img.pollIntervalMs);
                } else {
                    resolve(url);
                }
            }
            check();
        });
    }

    function downloadImage(url, filename) {
        return new Promise((resolve, reject) => {
            if (/\.(jpg|jpeg)$/i.test(filename)) {
                return fetch(url)
                    .then(r => r.ok ? r.blob() : Promise.reject(new Error("Network response not ok")))
                    .then(blob => triggerDownload(blob, filename))
                    .then(resolve)
                    .catch(e => {
                        window.open(url, '_blank', 'noopener,noreferrer');
                        resolve();
                    });
            }

            if (/\.(png|webp)$/i.test(filename)) {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = function () {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = img.naturalWidth || img.width;
                    canvas.height = img.naturalHeight || img.height;

                    try {
                        ctx.fillStyle = '#FFFFFF';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(img, 0, 0);

                        canvas.toBlob(function (blob) {
                            if (blob) {
                                triggerDownload(blob, filename.replace(/\.(png|webp)$/i, '.jpg'));
                                resolve();
                            } else {
                                window.open(url, '_blank', 'noopener,noreferrer');
                                resolve();
                            }
                        }, 'image/jpeg', CONFIG.img.jpegQuality);
                    } catch (e) {
                        console.warn("[Facebook Media Extractor] Canvas tainted, falling back to new tab.", e);
                        window.open(url, '_blank', 'noopener,noreferrer');
                        resolve();
                    }
                };
                img.onerror = () => {
                    window.open(url, '_blank', 'noopener,noreferrer');
                    resolve();
                };
                img.src = url;
                return;
            }

            fetch(url)
                .then(r => r.ok ? r.blob() : Promise.reject(new Error("Network failure")))
                .then(blob => triggerDownload(blob, filename))
                .then(resolve)
                .catch(() => {
                    window.open(url, '_blank', 'noopener,noreferrer');
                    resolve();
                });
        });
    }

    function triggerDownload(blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }

    // ---------- UI Interactions ----------
    async function executeWithVisualFeedback(btn, baseIcon, actionFn, showSuccess = true) {
        if (btn.dataset.loading === "1") return;

        btn.dataset.loading = "1";
        btn.replaceChildren(createIconElement(ICONS.spinner));

        try {
            await actionFn();
            if (showSuccess) {
                btn.replaceChildren(createIconElement(ICONS.check));
            } else {
                btn.replaceChildren(createIconElement(baseIcon));
            }
        } catch (error) {
            console.error("[Facebook Media Extractor] Action failed:", error);
            btn.replaceChildren(createIconElement(baseIcon));
        } finally {
            if (showSuccess) {
                setTimeout(() => {
                    delete btn.dataset.loading;
                    btn.replaceChildren(createIconElement(baseIcon));
                }, CONFIG.ui.successDurationMs);
            } else {
                delete btn.dataset.loading;
            }
        }
    }

    // ---------- DOM Injection ----------
    function constructOverlay(imgEl, filename, isStory) {
        if (!imgEl || processedElements.has(imgEl)) return;

        const parent = imgEl.parentElement;
        if (!parent) return;

        const container = document.createElement('div');
        container.className = 'xiv-fb-btn-container';
        if (isStory) container.classList.add('xiv-story-mode');

        // Open Button
        const openBtn = document.createElement('div');
        openBtn.className = 'xiv-fb-btn';
        openBtn.title = 'Open High-Res Image';
        openBtn.appendChild(createIconElement(ICONS.open));
        openBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation(); e.preventDefault();
            executeWithVisualFeedback(openBtn, ICONS.open, async () => {
                const url = await getHighResUrl(imgEl);
                if (url) window.open(url, '_blank', 'noopener,noreferrer');
            }, false);
        });

        // Download Button
        const dlBtn = document.createElement('div');
        dlBtn.className = 'xiv-fb-btn';
        dlBtn.title = 'Download Image';
        dlBtn.appendChild(createIconElement(ICONS.download));
        dlBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation(); e.preventDefault();
            executeWithVisualFeedback(dlBtn, ICONS.download, async () => {
                const url = await getHighResUrl(imgEl);
                if (url) await downloadImage(url, filename);
            });
        });

        container.appendChild(openBtn);
        container.appendChild(dlBtn);

        // Safe DOM insertion
        if (imgEl.nextSibling) {
            parent.insertBefore(container, imgEl.nextSibling);
        } else {
            parent.appendChild(container);
        }

        // Handle hover hook for standard photos
        if (!isStory) {
            // Force a DOM reflow BEFORE adding the hover class.
            // This prevents the browser from skipping the entrance transition
            // if the user is already resting their mouse on the image area during load.
            void container.offsetWidth;

            parent.classList.add('xiv-photo-parent');
        }

        processedElements.add(imgEl);
    }

    const processTargets = debounce(() => {
        if (/\/photo/.test(location.pathname)) {
            const photoNodes = document.querySelectorAll(CONFIG.selectors.photoDialog);
            for (const img of photoNodes) {
                if (isElementSufficientSize(img)) {
                    const res = getResolutionString(img);
                    const ext = img.src.includes('.png') ? 'png' : img.src.includes('.webp') ? 'webp' : 'jpg';
                    constructOverlay(img, `fb-photo-${res}-${generateId(8)}.${ext}`, false);
                }
            }
        }

        if (/\/stories\//.test(location.pathname)) {
            const storyNodes = document.querySelectorAll(CONFIG.selectors.photoDialog);
            for (const img of storyNodes) {
                if (isElementSufficientSize(img)) {
                    const res = getResolutionString(img);
                    const ext = img.src.includes('.png') ? 'png' : img.src.includes('.webp') ? 'webp' : 'jpg';
                    constructOverlay(img, `fb-story-${res}-${generateId(8)}.${ext}`, true);
                }
            }
        }
    }, CONFIG.ui.debounceMs);

    // ---------- Lifecycle Observers ----------
    const domObserver = new MutationObserver((mutations) => {
        let requiresCheck = false;
        for (const m of mutations) {
            if (m.type === 'attributes' && m.attributeName === 'src') {
                requiresCheck = true; break;
            }
            if (m.addedNodes.length > 0) {
                requiresCheck = true; break;
            }
        }
        if (requiresCheck) processTargets();
    });

    function initObserver() {
        domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
        processTargets();
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            domObserver.disconnect();
        } else {
            initObserver();
        }
    });

    initObserver();

})();
