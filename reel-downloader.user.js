// ==UserScript==
// @name         [Facebook] Reel Downloader
// @namespace    https://github.com/myouisaur/Facebook
// @icon         https://www.facebook.com/favicon.ico
// @version      8.0
// @description  Adds a responsive button to safely route and download Facebook reels via FDownloader.
// @author       Xiv
// @match        *://*.facebook.com/*
// @match        *://fdownloader.net/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_openInTab
// @run-at       document-idle
// @noframes
// @updateURL    https://myouisaur.github.io/Facebook/reel-downloader.user.js
// @downloadURL  https://myouisaur.github.io/Facebook/reel-downloader.user.js
// ==/UserScript==

(function() {
    'use strict';

    if (window.__fbReelDownloaderRunning) return;
    window.__fbReelDownloaderRunning = true;

    // ==========================================
    // CENTRALIZED CONFIGURATION
    // ==========================================
    const CONFIG = {
        DEBUG: false,
        LOG_PREFIX: '[FB Reel Downloader]',
        FDOWNLOADER_URL: 'https://fdownloader.net/en',
        STORED_LINK_KEY: 'fb_stored_link',
        DEBOUNCE_TIME_MS: 2000,
        OBSERVER_TIMEOUT_MS: 10000,
        SVG_PATHS: {
            DOWNLOAD: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
            SUCCESS: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
            ERROR: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
        },
        selectors: {
            fdown: {
                input: ['#s_input', '.search__input'],
                submit: ['button.btn-red[onclick*="ksearchvideo"]', '#btn-submit', '.search__button', 'button.btn-red']
            }
        }
    };

    function log(...args) {
        if (CONFIG.DEBUG) console.log(CONFIG.LOG_PREFIX, ...args);
    }

    function warn(...args) {
        console.warn(CONFIG.LOG_PREFIX, ...args);
    }

    // Modern FDownloader Utilities
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const domUtils = {
        simulateClick: (element) => {
            if (!element) return;
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            element.click();
        },
        setInputValue: (inputEl, value) => {
            try {
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (nativeSetter) nativeSetter.call(inputEl, value);
                else inputEl.value = value;

                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {
                warn('Failed to inject value into input', e);
            }
        },
        waitForElement: (selectors, timeoutMs = 15000) => {
            const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
            return new Promise((resolve, reject) => {
                const checkElements = () => {
                    for (const sel of selectorArray) {
                        const el = document.querySelector(sel);
                        if (el) return el;
                    }
                    return null;
                };

                const initial = checkElements();
                if (initial) return resolve(initial);

                const observer = new MutationObserver((_, obs) => {
                    const found = checkElements();
                    if (found) {
                        obs.disconnect();
                        clearTimeout(timer);
                        resolve(found);
                    }
                });

                observer.observe(document.body, { childList: true, subtree: true });

                const timer = setTimeout(() => {
                    observer.disconnect();
                    reject(new Error(`Element(s) '${selectorArray.join(', ')}' not found`));
                }, timeoutMs);
            });
        }
    };

    // ==========================================
    // CORE INITIALIZATION
    // ==========================================
    function init() {
        if (window.location.hostname.includes('facebook.com')) {
            log('Initializing Facebook route tracker...');

            const styleId = 'fb-dl-styles';
            if (!document.getElementById(styleId)) {
                const style = document.createElement('style');
                style.id = styleId;
                style.textContent = `
                    #fb-dl-btn { width: 40px; height: 40px; background-color: var(--secondary-button-background, rgba(255, 255, 255, 0.1)); color: var(--primary-icon, #E5E7EB); border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 9999; transition: background-color 0.2s ease, opacity 0.2s ease, transform 0.1s ease; user-select: none; flex-shrink: 0; margin-right: 8px; box-sizing: border-box; }
                    #fb-dl-btn:focus-visible { outline: 2px solid #1877F2; outline-offset: 2px; }
                    #fb-dl-btn:not(.fb-dl-disabled):hover { background-color: var(--secondary-button-background-floating, rgba(255, 255, 255, 0.25)); transform: scale(1.05); }
                    #fb-dl-btn.fb-dl-disabled { opacity: 0.6; cursor: not-allowed; transform: scale(0.95); }
                    #fb-dl-btn svg { width: 20px; height: 20px; fill: currentColor; pointer-events: none; }
                    #fb-dl-btn.fb-dl-success { background-color: #E5E7EB !important; color: #1A1A1A !important; }
                    #fb-dl-btn.fb-dl-error { background-color: #dc3545 !important; color: #ffffff !important; }
                `;
                document.head.appendChild(style);
            }

            setupZeroOverheadUrlTracker();
            checkCurrentRoute();
        } else if (window.location.hostname.includes('fdownloader.net')) {
            log('Initializing FDownloader logic...');
            initFDownloader();
        }
    }

    // ==========================================
    // FACEBOOK UI LOGIC (Untouched strictly from v7.6)
    // ==========================================
    function setupZeroOverheadUrlTracker() {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function() {
            originalPushState.apply(this, arguments);
            window.dispatchEvent(new Event('locationchange'));
        };

        history.replaceState = function() {
            originalReplaceState.apply(this, arguments);
            window.dispatchEvent(new Event('locationchange'));
        };

        window.addEventListener('popstate', () => {
            setTimeout(() => window.dispatchEvent(new Event('locationchange')), 50);
        });
        window.addEventListener('locationchange', checkCurrentRoute);
    }

    function checkCurrentRoute() {
        const path = window.location.pathname;
        const isTargetPage = path.startsWith('/reel/') || path.startsWith('/reels/') || path.includes('/videos/') || path.startsWith('/watch/');

        requestAnimationFrame(() => {
            if (isTargetPage) {
                ensureButtonInHeader();
            } else {
                removeButton();
            }
        });
    }

    function ensureButtonInHeader() {
        if (document.getElementById('fb-dl-btn')) return;
        const menuBtn = document.querySelector('div[aria-label="Facebook menu"]');
        if (menuBtn) {
            injectButton(menuBtn);
        } else {
            waitForMenuButtonAndInject();
        }
    }

    function waitForMenuButtonAndInject() {
        log('Menu button not found yet, setting up observer...');
        const observer = new MutationObserver((mutations, obs) => {
            const menuBtn = document.querySelector('div[aria-label="Facebook menu"]');
            if (menuBtn) {
                obs.disconnect();
                clearTimeout(timeoutId);
                injectButton(menuBtn);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        const timeoutId = setTimeout(() => {
            observer.disconnect();
            warn('Observer timed out waiting for the Facebook Menu button.');
        }, CONFIG.OBSERVER_TIMEOUT_MS);
    }

    function injectButton(menuBtn) {
        if (document.getElementById('fb-dl-btn')) return;

        const targetContainer = menuBtn.closest('span');
        if (!targetContainer || !targetContainer.parentElement) {
            warn('Could not find suitable parent container for header injection.');
            return;
        }

        const button = document.createElement('div');
        button.id = 'fb-dl-btn';
        button.title = 'Download via FDownloader';
        button.dataset.clicking = "false";
        button.tabIndex = 0;
        button.setAttribute('role', 'button');
        button.setAttribute('aria-label', 'Download Facebook Video');

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', CONFIG.SVG_PATHS.DOWNLOAD);
        svg.appendChild(path);

        button.appendChild(svg);

        button.addEventListener('click', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            await handleButtonClick(this, path);
        });

        button.addEventListener('keydown', async function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                await handleButtonClick(this, path);
            }
        });

        targetContainer.parentElement.insertBefore(button, targetContainer);
        log('Download button injected into header');
    }

    function removeButton() {
        const btn = document.getElementById('fb-dl-btn');
        if (btn) {
            btn.remove();
            log('Download button removed');
        }
    }

    async function handleButtonClick(clickedButton, pathElement) {
        if (clickedButton.dataset.clicking === "true") return;

        requestAnimationFrame(() => {
            clickedButton.dataset.clicking = "true";
            clickedButton.classList.add('fb-dl-disabled');
        });

        let rawUrl = window.location.href;
        let cleanUrl = rawUrl;

        // NEW: Deep URL Scrubbing
        if (rawUrl.includes('/watch/')) {
            try {
                const urlObj = new URL(rawUrl);
                const videoId = urlObj.searchParams.get('v');
                if (videoId) cleanUrl = urlObj.origin + urlObj.pathname + '?v=' + videoId;
            } catch (e) {
                warn("Failed to parse watch URL, using raw", e);
            }
        } else {
            cleanUrl = rawUrl.split(/[?#]/)[0]; // Safely strip ALL tracking queries and hashes
        }

        // NEW: Timestamped payload for stale-click prevention
        const payload = JSON.stringify({ url: cleanUrl, time: Date.now() });

        try { GM_setValue(CONFIG.STORED_LINK_KEY, payload); }
        catch (e) { warn('Failed to save to GM storage', e); }

        requestAnimationFrame(() => {
            clickedButton.classList.add('fb-dl-success');
            pathElement.setAttribute('d', CONFIG.SVG_PATHS.SUCCESS);

            setTimeout(() => {
                GM_openInTab(CONFIG.FDOWNLOADER_URL, { active: true, insert: true });
            }, 150);
        });

        setTimeout(() => {
            requestAnimationFrame(() => {
                clickedButton.classList.remove('fb-dl-success', 'fb-dl-error', 'fb-dl-disabled');
                pathElement.setAttribute('d', CONFIG.SVG_PATHS.DOWNLOAD);
                clickedButton.dataset.clicking = "false";
            });
        }, CONFIG.DEBOUNCE_TIME_MS);
    }

    // ==========================================
    // FDOWNLOADER LOGIC (Upgraded Diagnostics)
    // ==========================================
    function initFDownloader() {
        const executeDownload = async () => {
            let rawData = null;
            try { rawData = GM_getValue(CONFIG.STORED_LINK_KEY); } catch(e) {}
            if (!rawData) return;

            let url = null;
            try {
                // NEW: Validate timestamp to prevent executing stale clicks
                const parsed = JSON.parse(rawData);
                if (Date.now() - parsed.time > 60000) {
                    log('Discarded stale link (older than 60s).');
                    try { GM_setValue(CONFIG.STORED_LINK_KEY, null); } catch(e) {}
                    return;
                }
                url = parsed.url;
            } catch (e) {
                url = rawData; // Fallback just in case older string data exists
            }

            if (!url) return;

            log('Starting automated processing for:', url);
            try { GM_setValue(CONFIG.STORED_LINK_KEY, null); } catch(e) {}

            try {
                document.title = "⏳ Processing..."; // NEW: Diagnostics
                const input = await domUtils.waitForElement(CONFIG.selectors.fdown.input);
                const submitBtn = await domUtils.waitForElement(CONFIG.selectors.fdown.submit);

                domUtils.setInputValue(input, url);
                await sleep(300);

                document.title = "✅ Ready!"; // NEW: Diagnostics
                domUtils.simulateClick(submitBtn);

            } catch (error) {
                document.title = "❌ Element Timeout"; // NEW: Diagnostics
                warn('Automation aborted:', error.message);
            }
        };

        executeDownload();
    }

    init();

})();
