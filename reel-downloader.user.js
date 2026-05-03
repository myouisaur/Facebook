// ==UserScript==
// @name         [Facebook] Reel Downloader
// @namespace    https://github.com/myouisaur/Facebook
// @icon         https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico
// @version      5.7
// @description  Adds a button to download Facebook reels via FDownloader
// @author       Xiv
// @match        *://*.facebook.com/*
// @match        *://fdownloader.net/en*
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

    const CONFIG = {
        FDOWNLOADER_URL: 'https://fdownloader.net/en',
        STORED_LINK_KEY: 'fb_stored_link',
        DEBOUNCE_TIME_MS: 2000
    };

    GM_addStyle(`
        #fb-fdownloader-btn {
            width: 48px; /* Slightly larger for easier clicking as a floating action button */
            height: 48px;
            background-color: rgba(58, 59, 60, 0.85); /* FB native dark-gray */
            color: #E5E7EB;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 99999; /* Max z-index to stay above everything */
            transition: background-color 0.2s ease, transform 0.2s ease, opacity 0.2s ease;
            user-select: none;

            /* Fixed Bottom-Left Placement */
            position: fixed;
            bottom: 24px;
            left: 24px;
            margin: 0;
            box-sizing: border-box;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5); /* Added drop shadow for visibility */
        }

        #fb-fdownloader-btn:not(.disabled):hover {
            background-color: rgba(74, 75, 76, 0.95);
            transform: scale(1.05);
        }

        #fb-fdownloader-btn.disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        #fb-fdownloader-btn svg {
            width: 24px;
            height: 24px;
            fill: currentColor;
        }

        #fb-fdownloader-btn.success {
            background-color: #E5E7EB !important;
            color: #1A1A1A !important;
        }

        #fb-fdownloader-btn.error {
            background-color: #dc3545 !important;
            color: #ffffff !important;
        }
    `);

    // --- Core Initialization ---
    function init() {
        if (window.location.hostname.includes('facebook.com')) {
            setupZeroOverheadUrlTracker();
            checkCurrentRoute();
        } else if (window.location.hostname.includes('fdownloader.net')) {
            initFDownloader();
        }
    }

    // ==========================================
    // FACEBOOK UI LOGIC (Static Placement)
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

        if (isTargetPage) {
            injectButton();
        } else {
            removeButton();
        }
    }

    function injectButton() {
        if (document.getElementById('fb-fdownloader-btn')) return;

        const button = document.createElement('div');
        button.id = 'fb-fdownloader-btn';
        button.title = 'Download via FDownloader';
        button.dataset.clicking = "false";

        button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
        `;

        button.addEventListener('click', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            await handleButtonClick(this);
        });

        // Append directly to the body, bypassing Facebook's React containers completely
        document.body.appendChild(button);
    }

    function removeButton() {
        const btn = document.getElementById('fb-fdownloader-btn');
        if (btn) btn.remove();
    }

    async function handleButtonClick(clickedButton) {
        if (clickedButton.dataset.clicking === "true") return;
        clickedButton.dataset.clicking = "true";
        clickedButton.classList.add('disabled');

        let rawUrl = window.location.href;
        let cleanUrl = rawUrl;

        // Smart URL Sanitization
        if (rawUrl.includes('/watch/')) {
            try {
                const urlObj = new URL(rawUrl);
                const videoId = urlObj.searchParams.get('v');
                if (videoId) {
                    cleanUrl = urlObj.origin + urlObj.pathname + '?v=' + videoId;
                }
            } catch (e) {
                console.warn("Failed to parse watch URL, using raw");
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
                console.error("FB Downloader: All clipboard methods failed", fallbackErr);
            }
        }

        if (copiedSuccessfully) {
            GM_setValue(CONFIG.STORED_LINK_KEY, cleanUrl);
            clickedButton.classList.add('success');
            setTimeout(() => GM_openInTab(CONFIG.FDOWNLOADER_URL, { active: true, insert: true }), 150);
        } else {
            clickedButton.classList.add('error');
        }

        setTimeout(() => {
            clickedButton.classList.remove('success', 'error', 'disabled');
            clickedButton.dataset.clicking = "false";
        }, CONFIG.DEBOUNCE_TIME_MS);
    }

    // ==========================================
    // FDOWNLOADER LOGIC
    // ==========================================

    function initFDownloader() {
        const storedLink = GM_getValue(CONFIG.STORED_LINK_KEY);
        if (storedLink) {
            fillInputField(storedLink);
            GM_setValue(CONFIG.STORED_LINK_KEY, null);
        }
    }

    function fillInputField(url) {
        const maxAttempts = 40;
        let attempts = 0;

        const interval = setInterval(() => {
            const inputField = document.getElementById('s_input') || document.querySelector('.search__input');

            if (inputField) {
                inputField.value = url;
                inputField.focus();

                inputField.dispatchEvent(new Event('input', { bubbles: true }));
                inputField.dispatchEvent(new Event('change', { bubbles: true }));

                clearInterval(interval);
                clickDownloadButton();
            }

            attempts++;
            if (attempts >= maxAttempts) {
                clearInterval(interval);
                console.warn('FDownloader input field not found');
            }
        }, 200);
    }

    function clickDownloadButton() {
        setTimeout(() => {
            const downloadBtn = document.querySelector('button.btn-red[onclick*="ksearchvideo"]') || document.querySelector('button.btn-red');

            if (downloadBtn) {
                downloadBtn.click();
            } else {
                console.warn('Download button not found');
            }
        }, 500);
    }

    init();

})();
