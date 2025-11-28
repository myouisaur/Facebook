// ==UserScript==
// @name         [Facebook] Story & Reel Downloader
// @namespace    https://github.com/myouisaur/Facebook
// @icon         https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico
// @version      1.21
// @description  Adds a floating button to send Facebook stories and reels to FDownloader for easy downloading
// @author       Xiv
// @match        *://*.facebook.com/*
// @match        *://fdownloader.net/en*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_openInTab
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @run-at       document-idle
// @updateURL    https://myouisaur.github.io/Facebook/story-downloader.user.js
// @downloadURL  https://myouisaur.github.io/Facebook/story-downloader.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        FDOWNLOADER_URL: 'https://fdownloader.net/en',
        STORED_LINK_KEY: 'fb_stored_link'
    };

    // Add styles - redesigned to match Facebook's style
    GM_addStyle(`
        #fb-fdownloader-btn {
            position: fixed;
            bottom: 20px;
            right: 90px;
            width: 48px;
            height: 48px;
            background-color: rgba(58, 59, 60, 0.85);
            color: #ffffff;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1);
            z-index: 9999;
            transition: background-color 0.2s;
            user-select: none;
        }

        #fb-fdownloader-btn:hover {
            background-color: rgba(74, 75, 76, 0.9);
        }

        #fb-fdownloader-btn svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
        }

        #fb-fdownloader-btn.success {
            background-color: rgba(40, 167, 69, 0.85);
        }
    `);

    // State management
    let button = null;
    let urlObserver = null;

    // Initialize based on current site
    function init() {
        if (window.location.hostname === 'www.facebook.com') {
            // Always monitor URL changes on Facebook
            monitorUrlChanges();

            // Show button if starting on stories or reels page
            if (isOnStoriesOrReelsPage()) {
                createFloatingButton();
            }
        } else if (window.location.hostname === 'fdownloader.net') {
            initFDownloader();
        }
    }

    // Check if currently on stories or reels page
    function isOnStoriesOrReelsPage() {
        return window.location.hostname === 'www.facebook.com' &&
               (window.location.pathname.startsWith('/stories/') ||
                window.location.pathname.startsWith('/reel/'));
    }

    // Monitor URL changes for single-page app navigation
    function monitorUrlChanges() {
        // Disconnect existing observer if any
        if (urlObserver) {
            urlObserver.disconnect();
        }

        let lastUrl = window.location.href;

        urlObserver = new MutationObserver(() => {
            const currentUrl = window.location.href;
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                handleUrlChange();
            }
        });

        // Use throttled observation to reduce CPU usage
        urlObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function handleUrlChange() {
        if (isOnStoriesOrReelsPage()) {
            // Show button if it doesn't exist
            if (!document.getElementById('fb-fdownloader-btn')) {
                createFloatingButton();
            }
        } else {
            // Hide button when leaving stories/reels
            removeButton();
        }
    }

    function createFloatingButton() {
        // Avoid duplicate buttons
        if (document.getElementById('fb-fdownloader-btn')) return;

        button = document.createElement('div');
        button.id = 'fb-fdownloader-btn';
        button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
        `;
        button.title = 'Download Story/Reel';

        // Click handler
        button.addEventListener('click', handleButtonClick);

        document.body.appendChild(button);
    }

    function handleButtonClick() {
        const currentUrl = window.location.href;

        // Copy to clipboard
        GM_setClipboard(currentUrl);

        // Store the link
        GM_setValue(CONFIG.STORED_LINK_KEY, currentUrl);

        // Visual feedback
        button.classList.add('success');
        button.title = 'Link copied!';
        setTimeout(() => {
            button.classList.remove('success');
            button.title = 'Download Story/Reel';
        }, 300);

        // Open FDownloader in new tab
        GM_openInTab(CONFIG.FDOWNLOADER_URL, { active: true, insert: true });
    }

    // FDownloader functionality
    function initFDownloader() {
        const storedLink = GM_getValue(CONFIG.STORED_LINK_KEY);

        if (storedLink) {
            fillInputField(storedLink);
            // Clear stored link after use
            GM_setValue(CONFIG.STORED_LINK_KEY, null);
        }
    }

    function fillInputField(url) {
        // Wait for the input field to be available
        const maxAttempts = 20;
        let attempts = 0;

        const interval = setInterval(() => {
            const inputField = document.getElementById('s_input');

            if (inputField) {
                inputField.value = url;
                inputField.focus();

                // Trigger input event for any listeners
                inputField.dispatchEvent(new Event('input', { bubbles: true }));
                inputField.dispatchEvent(new Event('change', { bubbles: true }));

                clearInterval(interval);

                // Click the Download button after filling
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
        // Wait a moment for the page to process the input
        setTimeout(() => {
            const downloadBtn = document.querySelector('button.btn-red[onclick*="ksearchvideo"]');

            if (downloadBtn) {
                downloadBtn.click();
            } else {
                console.warn('Download button not found');
            }
        }, 500);
    }

    // Cleanup function to prevent memory leaks
    function cleanup() {
        removeButton();

        // Disconnect observer
        if (urlObserver) {
            urlObserver.disconnect();
            urlObserver = null;
        }
    }

    function removeButton() {
        if (button && button.parentNode) {
            button.removeEventListener('click', handleButtonClick);
            button.remove();
            button = null;
        }
    }

    // Initialize on page load
    init();

    // Cleanup on page unload
    window.addEventListener('beforeunload', cleanup);

})();
