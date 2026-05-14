// ==UserScript==
// @name         [Facebook] Reel Downloader
// @namespace    https://github.com/myouisaur/Facebook
// @icon         https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico
// @version      7.1
// @description  Adds a responsive button to safely route and download Facebook reels via FDownloader.
// @author       Xiv
// @match        *://*.facebook.com/*
// @match        *://fdownloader.net/en*
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_openInTab
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @run-at       document-idle
// @updateURL    https://myouisaur.github.io/Facebook/reel-downloader.user.js
// @downloadURL  https://myouisaur.github.io/Facebook/reel-downloader.user.js
// ==/UserScript==

(function() {
    'use strict';

    if (window.__fbReelDownloaderRunning) return;
    window.__fbReelDownloaderRunning = true;

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
        }
    };

    function log(...args) {
        if (CONFIG.DEBUG) console.log(CONFIG.LOG_PREFIX, ...args);
    }

    function warn(...args) {
        console.warn(CONFIG.LOG_PREFIX, ...args);
    }

    GM_addStyle(`
        #fb-dl-btn {
            width: 40px;
            height: 40px;
            background-color: var(--secondary-button-background, rgba(255, 255, 255, 0.1));
            color: var(--primary-icon, #E5E7EB);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 9999;
            transition: background-color 0.2s ease, opacity 0.2s ease, transform 0.1s ease;
            user-select: none;
            flex-shrink: 0;
            margin-right: 8px; /* Gap before the Menu button */
            box-sizing: border-box;
        }

        #fb-dl-btn:focus-visible {
            outline: 2px solid #1877F2;
            outline-offset: 2px;
        }

        #fb-dl-btn:not(.fb-dl-disabled):hover {
            background-color: var(--secondary-button-background-floating, rgba(255, 255, 255, 0.25));
            transform: scale(1.05);
        }

        #fb-dl-btn.fb-dl-disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: scale(0.95);
        }

        #fb-dl-btn svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
            pointer-events: none;
        }

        #fb-dl-btn.fb-dl-success {
            background-color: #E5E7EB !important;
            color: #1A1A1A !important;
        }

        #fb-dl-btn.fb-dl-error {
            background-color: #dc3545 !important;
            color: #ffffff !important;
        }
    `);

    // ==========================================
    // CORE INITIALIZATION
    // ==========================================

    function init() {
        if (window.location.hostname.includes('facebook.com')) {
            log('Initializing Facebook route tracker...');
            setupZeroOverheadUrlTracker();
            checkCurrentRoute();
        } else if (window.location.hostname.includes('fdownloader.net')) {
            log('Initializing FDownloader logic...');
            initFDownloader();
        }
    }

    // ==========================================
    // FACEBOOK UI LOGIC
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
        const isTargetPage = path.startsWith('/reel/') ||
                             path.startsWith('/reels/') ||
                             path.includes('/videos/') ||
                             path.startsWith('/watch/');

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

        // Facebook wraps the menu button in a span inside a flex container
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

        // Insert right before the menu button's wrapper span
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

        if (rawUrl.includes('/watch/')) {
            try {
                const urlObj = new URL(rawUrl);
                const videoId = urlObj.searchParams.get('v');
                if (videoId) {
                    cleanUrl = urlObj.origin + urlObj.pathname + '?v=' + videoId;
                }
            } catch (e) {
                warn("Failed to parse watch URL, using raw", e);
            }
        } else {
            cleanUrl = rawUrl.split('?')[0];
        }

        let copiedSuccessfully = false;

        try {
            if (typeof GM_setClipboard !== 'undefined') {
                GM_setClipboard(cleanUrl);
                copiedSuccessfully = true;
            } else {
                throw new Error("GM_setClipboard unavailable");
            }
        } catch (err) {
            try {
                await navigator.clipboard.writeText(cleanUrl);
                copiedSuccessfully = true;
            } catch (fallbackErr) {
                warn("All clipboard methods failed", fallbackErr);
            }
        }

        requestAnimationFrame(() => {
            if (copiedSuccessfully) {
                try {
                    GM_setValue(CONFIG.STORED_LINK_KEY, cleanUrl);
                } catch (e) {
                    warn('Failed to save to GM storage', e);
                }

                clickedButton.classList.add('fb-dl-success');
                pathElement.setAttribute('d', CONFIG.SVG_PATHS.SUCCESS);
                setTimeout(() => GM_openInTab(CONFIG.FDOWNLOADER_URL, { active: true, insert: true }), 150);
            } else {
                clickedButton.classList.add('fb-dl-error');
                pathElement.setAttribute('d', CONFIG.SVG_PATHS.ERROR);
            }
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
    // FDOWNLOADER LOGIC
    // ==========================================

    function initFDownloader() {
        let storedLink = null;
        try {
            storedLink = GM_getValue(CONFIG.STORED_LINK_KEY);
        } catch (e) {
            warn("Failed to read from GM storage", e);
        }

        if (storedLink) {
            log('Found stored link, attempting to fill...');
            try {
                GM_setValue(CONFIG.STORED_LINK_KEY, null);
            } catch (e) {
                warn("Failed to clear GM storage", e);
            }
            waitForInputAndFill(storedLink);
        }
    }

    function waitForInputAndFill(url) {
        const checkForInput = () => document.getElementById('s_input') || document.querySelector('.search__input');

        let inputField = checkForInput();

        if (inputField) {
            triggerDownload(inputField, url);
            return;
        }

        log('Input not found immediately, setting up observer...');

        const observer = new MutationObserver((mutations, obs) => {
            inputField = checkForInput();
            if (inputField) {
                obs.disconnect();
                clearTimeout(timeoutId);
                triggerDownload(inputField, url);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        const timeoutId = setTimeout(() => {
            observer.disconnect();
            warn('Observer timed out waiting for input field.');
        }, CONFIG.OBSERVER_TIMEOUT_MS);
    }

    function triggerDownload(inputField, url) {
        inputField.value = url;
        inputField.focus();

        inputField.dispatchEvent(new Event('input', { bubbles: true }));
        inputField.dispatchEvent(new Event('change', { bubbles: true }));

        setTimeout(() => {
            const selectors = [
                'button.btn-red[onclick*="ksearchvideo"]',
                '#btn-submit',
                '.search__button',
                'button.btn-red'
            ];

            let downloadBtn = null;
            for (const selector of selectors) {
                downloadBtn = document.querySelector(selector);
                if (downloadBtn) break;
            }

            if (downloadBtn) {
                log('Triggering download click');
                downloadBtn.click();
            } else {
                warn('Download button not found using any known selectors');
            }
        }, 500);
    }

    init();

})();
