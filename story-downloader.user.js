// ==UserScript==
// @name         [Facebook] Story Downloader
// @namespace    https://github.com/myouisaur/Facebook
// @icon         https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico
// @version      1.18
// @description  Adds a floating button to send Facebook stories to FDownloader for easy downloading
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
        BUTTON_HTML: '📥',
        STORED_LINK_KEY: 'fb_stored_link'
    };

    // Add styles
    GM_addStyle(`
        #fb-fdownloader-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 56px;
            height: 56px;
            background-color: #1877f2;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 9999;
            transition: transform 0.2s, box-shadow 0.2s, background-color 0.3s;
            user-select: none;
        }

        #fb-fdownloader-btn:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 16px rgba(0,0,0,0.2);
        }

        #fb-fdownloader-btn.success {
            background-color: #28a745;
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

            // Show button if starting on stories page
            if (isOnStoriesPage()) {
                createFloatingButton();
            }
        } else if (window.location.hostname === 'fdownloader.net') {
            initFDownloader();
        }
    }

    // Check if currently on stories page
    function isOnStoriesPage() {
        return window.location.hostname === 'www.facebook.com' &&
               window.location.pathname.startsWith('/stories/');
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
        if (isOnStoriesPage()) {
            // Show button if it doesn't exist
            if (!document.getElementById('fb-fdownloader-btn')) {
                createFloatingButton();
            }
        } else {
            // Hide button when leaving stories
            removeButton();
        }
    }

    // Facebook functionality
    function initFacebook() {
        // Removed - no longer needed as separate function
    }

    function createFloatingButton() {
        // Avoid duplicate buttons
        if (document.getElementById('fb-fdownloader-btn')) return;

        button = document.createElement('div');
        button.id = 'fb-fdownloader-btn';
        button.innerHTML = CONFIG.BUTTON_HTML;
        button.title = 'Send to FDownloader';

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
            button.title = 'Send to FDownloader';
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
