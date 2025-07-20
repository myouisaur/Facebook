// ==UserScript==
// @name         Facebook Comment Section 'All comments' by default
// @namespace    https://github.com/myouisaur/Facebook
// @icon         https://static.xx.fbcdn.net/rsrc.php/y1/r/ay1hV6OlegS.ico
// @version      1.1
// @description  Automatically selects "All comments" on Facebook comment.
// @author       Xiv
// @match        https://*.facebook.com/*
// @grant        none
// @updateURL    https://myouisaur.github.io/Facebook/show-all-comments.user.js
// @downloadURL  https://myouisaur.github.io/Facebook/show-all-comments.user.js
// ==/UserScript==


(function () {
    'use strict';

    // === 1. Script Boot ===
    function scriptBoot() {
        setupFacebookAllCommentsSwitcher();
    }

    // === 2. Facebook Comment Filter Module ===
    function setupFacebookAllCommentsSwitcher() {
        if (!location.hostname.includes('facebook.com')) return;

        // --- CONFIGURATION ---
        const PREFERRED_OPTION = "All comments";
        const OTHER_OPTIONS = ["Most relevant", "Newest"];
        // --- END CONFIGURATION ---

        const switchedElements = new WeakSet();

        function simulateClick(el) {
            if (!el) return;
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }

        function switchToPreferredOnce(el) {
            if (window.__fb_comment_switching || switchedElements.has(el)) return;
            window.__fb_comment_switching = true;

            simulateClick(el); // Open dropdown

            const menuObserver = new MutationObserver(() => {
                const preferred = Array.from(document.querySelectorAll("span")).find(e =>
                    e.textContent.trim() === PREFERRED_OPTION &&
                    e.offsetParent !== null
                );

                if (preferred) {
                    simulateClick(preferred);
                    switchedElements.add(el);
                    menuObserver.disconnect();
                    setTimeout(() => {
                        window.__fb_comment_switching = false;
                    }, 500);
                }
            });

            menuObserver.observe(document.body, { childList: true, subtree: true });

            // Failsafe retry if dropdown hasn’t fully loaded
            setTimeout(() => {
                const fallbackPreferred = Array.from(document.querySelectorAll("span")).find(e =>
                    e.textContent.trim() === PREFERRED_OPTION &&
                    e.offsetParent !== null
                );

                if (fallbackPreferred && !switchedElements.has(el)) {
                    simulateClick(fallbackPreferred);
                    switchedElements.add(el);
                    menuObserver.disconnect();
                    setTimeout(() => {
                        window.__fb_comment_switching = false;
                    }, 500);
                }
            }, 1000);
        }

        function scanForDropdownsAndSwitch() {
            const dropdown = Array.from(document.querySelectorAll("span")).find(e =>
                OTHER_OPTIONS.includes(e.textContent.trim()) &&
                !switchedElements.has(e)
            );

            if (dropdown) {
                switchToPreferredOnce(dropdown);
            }
        }

        function observeNavigationAndContent() {
            let lastUrl = location.href;

            const navObserver = new MutationObserver(() => {
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    setTimeout(scanForDropdownsAndSwitch, 500);
                }
            });

            navObserver.observe(document.body, { childList: true, subtree: true });

            const dropdownObserver = new MutationObserver(() => {
                scanForDropdownsAndSwitch();
            });

            dropdownObserver.observe(document.body, { childList: true, subtree: true });
        }

        observeNavigationAndContent();
        scanForDropdownsAndSwitch();
    }

    // === Boot all modules ===
    scriptBoot();

})();
