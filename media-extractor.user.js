// ==UserScript==
// @name         [Facebook] Media Extractor
// @namespace    https://github.com/myouisaur/Facebook
// @icon         https://www.facebook.com/favicon.ico
// @version      4.4
// @description  Adds open and download buttons to Facebook images in photo and story views.
// @author       Xiv
// @match        *://*.facebook.com/*
// @noframes
// @grant        GM_addStyle
// @grant        GM_openInTab
// @updateURL    https://myouisaur.github.io/Facebook/media-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Facebook/media-extractor.user.js
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
            successDurationMs: 1000
        }
    };

    // ---------- State ----------
    const processedElements = new WeakSet();
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    // ---------- Icons (SVG Strings) ----------
    const ICONS = {
        download: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
        open: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`,
        check: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    };

    // ---------- Styling (Liquid Glass v2 + Morph Animations) ----------
    GM_addStyle(`
        /* ── Container ──────────────────────────────── */
        .xiv-btn-container {
            position: absolute !important;
            bottom: clamp(1rem, 2.5vw, 1.5rem);
            left: 50%;
            transform: translateX(-50%);
            z-index: 999999 !important;
            display: flex !important;
            gap: 8px;
            pointer-events: none;

            /* Bug fix: Transition visibility to allow child elements to handle their own opacity fade */
            visibility: hidden;
            transition: visibility 0s linear 0.3s;
        }

        /* Active/Visible states */
        .xiv-btn-container.xiv-visible {
            visibility: visible;
            pointer-events: auto;
            transition: visibility 0s;
        }

        /* Subtle radial shadow behind the container to help it read on any background */
        .xiv-btn-container::before {
            content: '';
            position: absolute;
            top: -20px; right: -25px; bottom: -20px; left: -25px;
            z-index: -1;
            background: radial-gradient(ellipse at center, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0) 65%);
            pointer-events: none;
            border-radius: 50%;

            /* Handles its own opacity decoupled from container */
            opacity: 0;
            transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .xiv-btn-container.xiv-visible::before {
            opacity: 1;
        }

        /* ── Button shell ────────────────────────────── */
        .xiv-action-btn {
            position: relative;
            width: 35px;
            height: 35px;
            border-radius: 50%;
            border: none;
            outline: none;
            overflow: hidden;
            cursor: pointer;
            display: flex !important;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            color: rgba(255, 255, 255, 0.96);

            /* Hardware acceleration & direct opacity transition to prevent Chromium backdrop-filter snapping */
            opacity: 0;
            will-change: transform, opacity;
            transform: translateZ(0);

            /* Frosted glass base */
            background: rgba(255, 255, 255, 0.14);
            backdrop-filter: blur(24px) saturate(180%) brightness(1.1);
            -webkit-backdrop-filter: blur(24px) saturate(180%) brightness(1.1);

            /* Layered inset highlights + drop shadow */
            box-shadow:
                inset 0  1.5px 0   rgba(255,255,255,0.75),
                inset 0 -1.5px 0   rgba(255,255,255,0.06),
                inset  1px 0   0   rgba(255,255,255,0.30),
                inset -1px 0   0   rgba(255,255,255,0.10),
                0 0 0 0.5px        rgba(255,255,255,0.20),
                0 6px 20px         rgba(0,0,0,0.32),
                0 2px  6px         rgba(0,0,0,0.20);

            transition:
                opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                box-shadow 0.35s ease,
                background 0.35s ease;
        }

        /* Button fade-in trigger */
        .xiv-btn-container.xiv-visible .xiv-action-btn {
            opacity: 1;
        }

        /* Loading State Override (Ghost-Click Fix) */
        .xiv-action-btn[data-loading="1"] {
            /* Physically intercepts clicks instead of passing through to underlying elements */
            cursor: default !important;
        }

        /* Out-of-Sync Fade Fix */
        .xiv-btn-container.xiv-visible .xiv-action-btn[data-loading="1"] {
            opacity: 0.8 !important;
        }

        /* ── Gradient border ring (mask-composite trick) ── */
        .xiv-action-btn::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 50%;
            padding: 1px;
            background: linear-gradient(
                155deg,
                rgba(255,255,255,0.72) 0%,
                rgba(255,255,255,0.35) 25%,
                rgba(255,255,255,0.08) 55%,
                rgba(255,255,255,0.22) 100%
            );
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
            pointer-events: none;
            z-index: 5;
            transition: background 0.35s ease;
        }

        /* ── Top glare / specular highlight ── */
        .xiv-action-btn::after {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 58%;
            background: radial-gradient(
                ellipse 75% 70% at 50% -8%,
                rgba(255,255,255,0.58)  0%,
                rgba(255,255,255,0.20) 40%,
                rgba(255,255,255,0.05) 70%,
                transparent            90%
            );
            border-radius: 50% 50% 0 0;
            pointer-events: none;
            z-index: 5;
            transition: background 0.35s ease;
        }

        /* ── Hover state ── */
        .xiv-action-btn:hover {
            background: rgba(255, 255, 255, 0.22);
            backdrop-filter: blur(32px) saturate(210%) brightness(1.18);
            -webkit-backdrop-filter: blur(32px) saturate(210%) brightness(1.18);
            box-shadow:
                inset 0  1.5px 0   rgba(255,255,255,0.85),
                inset 0 -1.5px 0   rgba(255,255,255,0.08),
                inset  1px 0   0   rgba(255,255,255,0.40),
                inset -1px 0   0   rgba(255,255,255,0.14),
                0 0 0 0.5px        rgba(255,255,255,0.28),
                0 10px 30px        rgba(0,0,0,0.38),
                0 3px 10px         rgba(0,0,0,0.22),
                0 0 22px           rgba(140,180,255,0.22);
        }

        /* ── Active / pressed state ── */
        .xiv-action-btn:active {
            transition:
                opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                box-shadow 0.10s ease;
            box-shadow:
                inset 0  1.5px 0  rgba(255,255,255,0.75),
                inset 0 -1.5px 0  rgba(255,255,255,0.06),
                inset  1px 0   0  rgba(255,255,255,0.30),
                inset -1px 0   0  rgba(255,255,255,0.10),
                0 0 0 0.5px       rgba(255,255,255,0.18),
                0 3px 10px        rgba(0,0,0,0.25);
        }

        /* ── Icon wrapper ── */
        .xiv-btn-icon {
            position: relative;
            z-index: 6;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 17px;
            height: 17px;
            color: rgba(255, 255, 255, 0.96);
            filter: drop-shadow(0 0 4px rgba(0,0,0,0.65)) drop-shadow(0 1px 3px rgba(0,0,0,0.50));
            transition: filter 0.35s ease;
            pointer-events: none;
        }

        .xiv-action-btn:hover .xiv-btn-icon {
            filter: drop-shadow(0 0 7px rgba(180,210,255,0.70)) drop-shadow(0 2px 4px rgba(0,0,0,0.55));
        }

        /* ── Icon Morph Transitions ── */
        .xiv-icon-inner {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            transition: opacity 0.15s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
            transform-origin: center;
        }

        .xiv-icon-inner.xiv-morphing {
            opacity: 0;
            transform: scale(0.25) rotate(-45deg);
        }

        .xiv-icon-inner svg {
            width: 100% !important;
            height: 100% !important;
            display: block !important;
        }

        /* ── INNER GLASS LAYERS ── */
        .xiv-glass-lens {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: radial-gradient(circle at 72% 56%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 45%, rgba(180,200,255,0.04) 80%, rgba(0,0,0,0) 100%);
            pointer-events: none;
            z-index: 1;
        }

        .xiv-glass-scatter {
            position: absolute;
            inset: 2px;
            border-radius: 50%;
            background: radial-gradient(ellipse 60% 50% at 38% 40%, rgba(255,255,255,0.09) 0%, transparent 65%);
            pointer-events: none;
            z-index: 2;
        }

        .xiv-glass-chroma {
            position: absolute;
            inset: 0;
            border-radius: 50%;
            background: radial-gradient(ellipse 100% 100% at 50% 50%, transparent 62%, rgba(80,200,255,0.09) 74%, rgba(255,80,100,0.07) 84%, transparent 92%);
            pointer-events: none;
            z-index: 3;
        }

        .xiv-glass-rim {
            position: absolute;
            bottom: 0; left: 10%; right: 10%;
            height: 40%;
            background: radial-gradient(ellipse 80% 100% at 50% 115%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.08) 45%, transparent 70%);
            border-radius: 0 0 50% 50%;
            pointer-events: none;
            z-index: 4;
        }

        /* ── Ripple ── */
        .xiv-glass-ripple {
            position: absolute;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.28);
            transform: scale(0);
            animation: xiv-ripple 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
            pointer-events: none;
            z-index: 7;
        }
        @keyframes xiv-ripple {
            to { transform: scale(2.8);
            opacity: 0; }
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
                        GM_openInTab(url, { active: false, insert: true, setParent: true });
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
                                GM_openInTab(url, { active: false, insert: true, setParent: true });
                                resolve();
                            }
                        }, 'image/jpeg', CONFIG.img.jpegQuality);
                    } catch (e) {
                        console.warn("[Facebook Media Extractor] Canvas tainted, falling back to new tab.", e);
                        GM_openInTab(url, { active: false, insert: true, setParent: true });
                        resolve();
                    }
                };
                img.onerror = () => {
                    GM_openInTab(url, { active: false, insert: true, setParent: true });
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
                    GM_openInTab(url, { active: false, insert: true, setParent: true });
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
    function swapIconSmoothly(iconWrapper, newSvgString) {
        let inner = iconWrapper.querySelector('.xiv-icon-inner');
        if (!inner) {
            inner = document.createElement('div');
            inner.className = 'xiv-icon-inner xiv-morphing';
            iconWrapper.replaceChildren(inner);
            void inner.offsetWidth; // Force reflow
        }

        return new Promise(resolve => {
            inner.classList.add('xiv-morphing');
            setTimeout(() => {
                inner.replaceChildren(createIconElement(newSvgString));
                void inner.offsetWidth; // Force reflow
                inner.classList.remove('xiv-morphing');
                setTimeout(resolve, 250);
            }, 150);
        });
    }

    async function executeWithVisualFeedback(btn, iconEl, baseIconString, actionFn, showSuccess = true) {
        if (btn.dataset.loading === "1") return;
        btn.dataset.loading = "1";

        try {
            await actionFn();
            if (showSuccess) {
                await swapIconSmoothly(iconEl, ICONS.check);
            }
        } catch (error) {
            console.error("[Facebook Media Extractor] Action failed:", error);
        } finally {
            if (showSuccess) {
                setTimeout(async () => {
                    await swapIconSmoothly(iconEl, baseIconString);
                    delete btn.dataset.loading;
                }, CONFIG.ui.successDurationMs);
            } else {
                delete btn.dataset.loading;
            }
        }
    }

    function createGlassButton(title, iconString, onClickAction) {
        const btn = document.createElement('div');
        btn.className = 'xiv-action-btn';
        btn.title = title;
        btn.setAttribute('role', 'button');
        btn.setAttribute('aria-label', title);
        btn.setAttribute('tabindex', '0');

        const lens = document.createElement('div');
        lens.className = 'xiv-glass-lens';
        const scatter = document.createElement('div');
        scatter.className = 'xiv-glass-scatter';
        const chroma = document.createElement('div');
        chroma.className = 'xiv-glass-chroma';
        const rim = document.createElement('div');
        rim.className = 'xiv-glass-rim';

        const iconEl = document.createElement('span');
        iconEl.className = 'xiv-btn-icon';
        const innerIconEl = document.createElement('div');
        innerIconEl.className = 'xiv-icon-inner';
        innerIconEl.appendChild(createIconElement(iconString));
        iconEl.appendChild(innerIconEl);
        btn.append(lens, scatter, chroma, rim, iconEl);

        const stopPropagation = (e) => { e.stopPropagation(); e.preventDefault(); };
        btn.addEventListener('pointerdown', function (e) {
            if (btn.dataset.loading === "1") return; // Prevent ripple if in loading/success state

            const r = btn.getBoundingClientRect();
            const size = Math.max(r.width, r.height);
            const rpl = document.createElement('div');
            rpl.className = 'xiv-glass-ripple';
            rpl.style.cssText = `width:${size}px; height:${size}px; left:${e.clientX - r.left - size / 2}px; top:${e.clientY - r.top - size / 2}px;`;
            btn.appendChild(rpl);
            rpl.addEventListener('animationend', () => rpl.remove());
        });
        // Event Sealing: Prevent clicks from hitting the underlying Facebook image/story link
        btn.addEventListener('mousedown', stopPropagation);
        btn.addEventListener('mouseup', stopPropagation);
        btn.addEventListener('click', (e) => {
            stopPropagation(e);
            onClickAction(btn, iconEl);
        });
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                stopPropagation(e);
                onClickAction(btn, iconEl);
            }
        });
        return btn;
    }

    function setupHoverContext(parentEl, containerEl) {
        parentEl.addEventListener('mouseenter', () => containerEl.classList.add('xiv-visible'));
        parentEl.addEventListener('mouseleave', () => containerEl.classList.remove('xiv-visible'));

        if (parentEl.matches(':hover')) {
            containerEl.classList.add('xiv-visible');
        }
    }

    // ---------- DOM Injection ----------
    function constructOverlay(imgEl, filename, isStory) {
        if (!imgEl || processedElements.has(imgEl)) return;
        const parent = imgEl.parentElement;
        if (!parent) return;

        const container = document.createElement('div');
        container.className = 'xiv-btn-container';
        if (isStory) container.classList.add('xiv-story-mode');
        const openBtn = createGlassButton('Open High-Res Image in Background', ICONS.open, (btn, iconEl) => {
            executeWithVisualFeedback(btn, iconEl, ICONS.open, async () => {
                const url = await getHighResUrl(imgEl);
                if (url) {
                    GM_openInTab(url, { active: false, insert: true, setParent: true });
                }
            }, true);
        });
        const dlBtn = createGlassButton('Download Image', ICONS.download, (btn, iconEl) => {
            executeWithVisualFeedback(btn, iconEl, ICONS.download, async () => {
                const url = await getHighResUrl(imgEl);
                if (url) await downloadImage(url, filename);
            });
        });
        container.appendChild(openBtn);
        container.appendChild(dlBtn);

        if (imgEl.nextSibling) {
            parent.insertBefore(container, imgEl.nextSibling);
        } else {
            parent.appendChild(container);
        }

        setupHoverContext(parent, container);
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
