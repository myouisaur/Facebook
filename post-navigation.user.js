// ==UserScript==
// @name         [Facebook] Post Navigation
// @namespace    https://github.com/myouisaur/Facebook
// @icon         https://www.facebook.com/favicon.ico
// @version      3.1
// @description  Adds a floating navigation panel to instantly snap or seamlessly scroll between posts across the Facebook home feed, groups, and profiles.
// @author       Xiv
// @match        *://*.facebook.com/*
// @noframes
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://myouisaur.github.io/Facebook/post-navigation.user.js
// @downloadURL  https://myouisaur.github.io/Facebook/post-navigation.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    if (window.__tmFbNavInitialized) return;
    window.__tmFbNavInitialized = true;

    // ============================================================================
    // 1. CONFIGURATION & STATE
    // ============================================================================
    const CONFIG = {
        DEBUG: false,
        enableKeyboard: true,

        selectors: {
            posts: 'div[data-pagelet^="FeedUnit_"], div[aria-posinset], div[role="article"]',
        },

        offsets: {
            home: 60,       // Standard top nav bar + padding
            contextual: 120 // Top nav + secondary sticky tab bars
        },

        thresholds: {
            minWidth: 300,
            minHeight: 250 // Bypasses the "Create Post" box and small carousels
        },

        timing: {
            throttle: 100,  // Keyboard nav throttle (ms)
            polling: 1000   // Featherweight visibility heartbeat (ms)
        },

        layout: {
            anchorBuffer: 5, // Target snapping safety buffer (px)
            topOfPage: 20    // ScrollY value considered "Top"
        },

        animation: {
            easeMultiplier: 0.3,
            minDuration: 200,
            maxDuration: 400,
            snapThreshold: 5
        },

        prefix: 'tm-fb-nav',

        colors: {
            brand: '#0866ff',
        },

        icons: {
            up: 'M18 15l-6-6-6 6',
            down: 'M6 9l6 6 6-6'
        }
    };

    const LOG = {
        info: (msg, ...args) => CONFIG.DEBUG && console.log(`[FB Nav] ${msg}`, ...args),
        warn: (msg, ...args) => CONFIG.DEBUG && console.warn(`[FB Nav] ${msg}`, ...args),
        error: (msg, ...args) => console.error(`[FB Nav] ${msg}`, ...args)
    };

    const SETTINGS = {
        get smoothScroll() {
            try {
                return GM_getValue('smoothScroll', true);
            } catch (e) {
                LOG.error('Storage read failed', e);
                return true;
            }
        },
        set smoothScroll(val) {
            try {
                GM_setValue('smoothScroll', val);
            } catch (e) {
                LOG.error('Storage write failed', e);
            }
        }
    };

    // ============================================================================
    // 2. STYLESHEET
    // ============================================================================
    const STYLES = `
        .${CONFIG.prefix}-container {
            position: fixed !important;
            right: clamp(12px, 2vw, 24px) !important;
            top: 50% !important;
            transform: translateY(-50%) !important;

            /* Hidden State (Default) */
            display: none !important;

            flex-direction: column !important;
            align-items: center !important;
            gap: clamp(8px, 1.5vh, 16px) !important;
            z-index: 2147483647 !important;
            pointer-events: none !important;
        }

        /* Visible State - Instant Toggle */
        .${CONFIG.prefix}-container.is-visible {
            display: flex !important;
        }

        .${CONFIG.prefix}-btn {
            pointer-events: auto !important;
            width: clamp(40px, 4vw, 48px) !important;
            height: clamp(40px, 4vw, 48px) !important;
            border-radius: 50% !important;
            background-color: rgba(38, 38, 38, 0.85) !important;
            backdrop-filter: blur(8px) !important;
            -webkit-backdrop-filter: blur(8px) !important;
            color: #ffffff !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            cursor: pointer !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
            padding: 0 !important;
            transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.2s ease !important;
        }

        .${CONFIG.prefix}-btn:hover {
            background-color: ${CONFIG.colors.brand} !important;
            transform: translateY(-2px) !important;
        }

        .${CONFIG.prefix}-btn svg {
            width: clamp(20px, 2vw, 24px) !important;
            height: clamp(20px, 2vw, 24px) !important;
            fill: none !important;
            stroke: currentColor !important;
            stroke-width: 2.5 !important;
            stroke-linecap: round !important;
            stroke-linejoin: round !important;
        }
    `;

    if (typeof GM_addStyle !== 'undefined') {
        GM_addStyle(STYLES);
    } else {
        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);
    }

    // ============================================================================
    // 3. UTILITIES & DOM BUILDERS
    // ============================================================================

    const DOM = {
        create(tag, className, options = {}) {
            const el = document.createElement(tag);
            if (className) el.className = className;
            Object.entries(options).forEach(([key, value]) => {
                if (key === 'textContent') el.textContent = value;
                else if (key === 'dataset') Object.assign(el.dataset, value);
                else el.setAttribute(key, value);
            });
            return el;
        },
        createSVG(pathData) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathData);
            svg.appendChild(path);
            return svg;
        }
    };

    // ============================================================================
    // 4. LOGIC & NAV ENGINE
    // ============================================================================

    class NavigationManager {
        constructor() {
            this.containerEl = null;
            this.currentTargetNode = null;

            this.lastNavTime = 0;
            this.scrollAnimFrame = null;

            this.registerMenu();
            this.buildUI();
            this.attachEvents();
            this.updateVisibility();
        }

        registerMenu() {
            if (typeof GM_registerMenuCommand !== 'undefined') {
                GM_registerMenuCommand('Toggle Smooth Scrolling', () => {
                    SETTINGS.smoothScroll = !SETTINGS.smoothScroll;
                    alert(`Facebook Post Navigation:\nSmooth Scrolling is now ${SETTINGS.smoothScroll ? 'ON' : 'OFF'}.`);
                });
            }
        }

        isPageValid() {
            const pathAndQuery = window.location.pathname + window.location.search;
            // Blacklist permalinks, single photo views, reels, and messages to prevent UI ghosting
            const blacklistRegex = /\/(photo|photo\.php|photos|permalink|posts|story\.php|stories|reel|messages)(\/|\?|$)/i;
            return !blacklistRegex.test(pathAndQuery);
        }

        getCurrentOffset() {
            const path = window.location.pathname;
            if (path === '/' || path.startsWith('/watch') || path.startsWith('/gaming')) {
                return CONFIG.offsets.home;
            }
            return CONFIG.offsets.contextual;
        }

        /**
         * JIT (Just-In-Time) DOM Engine
         * Evaluates the active document strictly at the moment of a button press.
         * Ensures virtualized or newly injected FB posts are perfectly mapped.
         */
        getFreshPosts() {
            try {
                const nodes = document.querySelectorAll(CONFIG.selectors.posts);
                const validNodes = [];
                let lastParent = null;

                for (let i = 0; i < nodes.length; i++) {
                    const el = nodes[i];

                    // Native containment check to skip nested inner-posts (e.g., carousels, shares)
                    if (lastParent && lastParent.contains(el)) continue;

                    const isNestedItem = el.parentElement && el.parentElement.closest(CONFIG.selectors.posts) !== null;
                    if (isNestedItem) continue;

                    const rect = el.getBoundingClientRect();

                    // Dimensions natively filter out detached elements (0x0 rect) and the Composer box
                    if (rect.height > CONFIG.thresholds.minHeight && rect.width > CONFIG.thresholds.minWidth) {
                        validNodes.push(el);
                        lastParent = el;
                    }
                }

                // document.querySelectorAll inherently returns elements in strict physical DOM order.
                // We do NOT sort by coordinates here, preventing FB layout shifts from scrambling the array.
                return validNodes;
            } catch (e) {
                LOG.error('Error fetching JIT posts', e);
                return [];
            }
        }

        animateScrollTo(target) {
            if (this.scrollAnimFrame) {
                cancelAnimationFrame(this.scrollAnimFrame);
            }

            const getTargetY = () => {
                if (typeof target === 'number') return target;
                return Math.max(0, (target.getBoundingClientRect().top + window.scrollY) - this.getCurrentOffset());
            };

            const startY = window.scrollY || window.pageYOffset;
            const initialTargetY = getTargetY();
            const distance = initialTargetY - startY;

            if (Math.abs(distance) < CONFIG.animation.snapThreshold) {
                window.scrollTo(0, initialTargetY);
                this.scrollAnimFrame = null;
                return;
            }

            const duration = Math.min(
                CONFIG.animation.maxDuration,
                Math.max(CONFIG.animation.minDuration, Math.abs(distance) * CONFIG.animation.easeMultiplier)
            );

            let startTime = null;

            const step = (currentTime) => {
                if (!startTime) startTime = currentTime;
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);

                const ease = progress * (2 - progress);

                // Recalculates dynamically every frame to act as a homing missile if FB shifts the post
                const dynamicDistance = getTargetY() - startY;

                window.scrollTo(0, startY + (dynamicDistance * ease));

                if (progress < 1) {
                    this.scrollAnimFrame = requestAnimationFrame(step);
                } else {
                    window.scrollTo(0, getTargetY());
                    this.scrollAnimFrame = null;
                }
            };

            this.scrollAnimFrame = requestAnimationFrame(step);
        }

        executeScroll(targetNode) {
            this.currentTargetNode = targetNode;

            if (SETTINGS.smoothScroll) {
                this.animateScrollTo(targetNode);
            } else {
                if (this.scrollAnimFrame) {
                    cancelAnimationFrame(this.scrollAnimFrame);
                    this.scrollAnimFrame = null;
                }
                const targetY = Math.max(0, (targetNode.getBoundingClientRect().top + window.scrollY) - this.getCurrentOffset());
                window.scrollTo(0, targetY);
            }
        }

        navigate(direction) {
            const now = Date.now();
            if (now - this.lastNavTime < CONFIG.timing.throttle) return false;
            this.lastNavTime = now;

            const posts = this.getFreshPosts();
            if (!posts.length) return false;

            let targetNode = null;

            // SEQUENCE LOCK: Ensures rapid button mashing perfectly steps through the array sequentially
            // even if the user outpaces the scroll animation.
            if (this.currentTargetNode) {
                const currentIndex = posts.indexOf(this.currentTargetNode);
                if (currentIndex !== -1) {
                    const nextIndex = direction === 'down' ? currentIndex + 1 : currentIndex - 1;
                    if (posts[nextIndex]) {
                        targetNode = posts[nextIndex];
                    }
                }
            }

            // FALLBACK / INITIAL NAV: Calculate using live physical geometry
            if (!targetNode) {
                const currentOffset = this.getCurrentOffset();
                const anchorDown = currentOffset + CONFIG.layout.anchorBuffer;
                const anchorUp = currentOffset - CONFIG.layout.anchorBuffer;

                if (direction === 'down') {
                    targetNode = posts.find(post => post.getBoundingClientRect().top > anchorDown);
                } else if (direction === 'up') {
                    targetNode = [...posts].reverse().find(post => post.getBoundingClientRect().top < anchorUp);

                    // If no valid post sits above us, snap to the absolute top of the page (Stories/Composer)
                    if (!targetNode && window.scrollY > (CONFIG.layout.topOfPage / 2)) {
                        this.currentTargetNode = null;
                        if (SETTINGS.smoothScroll) this.animateScrollTo(0);
                        else window.scrollTo(0, 0);
                        return true;
                    }
                }
            }

            if (targetNode) {
                this.executeScroll(targetNode);
                return true;
            }
            return false;
        }

        updateVisibility() {
            if (!this.containerEl) return;

            // Only hide the UI if the URL explicitly invalidates it, or the feed is completely barren.
            // Dropped to < 1 to prevent vanishing acts during SPA router hiccups.
            if (!this.isPageValid() || document.querySelectorAll(CONFIG.selectors.posts).length < 1) {
                if (this.containerEl.classList.contains('is-visible')) {
                    this.containerEl.classList.remove('is-visible');
                }
            } else {
                if (!this.containerEl.classList.contains('is-visible')) {
                    this.containerEl.classList.add('is-visible');
                }
            }
        }

        buildUI() {
            this.containerEl = DOM.create('div', `${CONFIG.prefix}-container`, {
                id: `${CONFIG.prefix}-main`,
                'aria-label': 'Post Navigation'
            });

            const btnUp = DOM.create('button', `${CONFIG.prefix}-btn`, {
                'aria-label': 'Previous Post',
                title: 'Previous Post (Arrow Up)'
            });
            btnUp.appendChild(DOM.createSVG(CONFIG.icons.up));
            btnUp.addEventListener('click', (e) => { e.preventDefault(); this.navigate('up'); });

            const btnDown = DOM.create('button', `${CONFIG.prefix}-btn`, {
                'aria-label': 'Next Post',
                title: 'Next Post (Arrow Down)'
            });
            btnDown.appendChild(DOM.createSVG(CONFIG.icons.down));
            btnDown.addEventListener('click', (e) => { e.preventDefault(); this.navigate('down'); });

            this.containerEl.appendChild(btnUp);
            this.containerEl.appendChild(btnDown);
            document.body.appendChild(this.containerEl);
        }

        attachEvents() {
            // Abort scroll locks if the user physically intervenes via mouse or touch
            const abortScroll = () => {
                if (this.scrollAnimFrame) {
                    cancelAnimationFrame(this.scrollAnimFrame);
                    this.scrollAnimFrame = null;
                }
                // Break the mathematical sequence lock, forcing the next press to use fresh spatial geometry
                this.currentTargetNode = null;
            };
            window.addEventListener('wheel', abortScroll, { passive: true });
            window.addEventListener('touchstart', abortScroll, { passive: true });

            if (CONFIG.enableKeyboard) {
                window.addEventListener('keydown', (e) => {
                    if (e.repeat) return;

                    const activeEl = document.activeElement;
                    if (activeEl) {
                        const tag = activeEl.tagName;
                        const role = activeEl.getAttribute('role');
                        const isTextInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
                        const isRichText = activeEl.isContentEditable || e.target.closest('[contenteditable="true"]');
                        const isAriaInput = role === 'textbox' || role === 'combobox';

                        if (isTextInput || isRichText || isAriaInput) return;
                    }

                    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;

                    let direction = null;
                    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') direction = 'up';
                    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') direction = 'down';

                    if (direction && this.navigate(direction)) {
                        e.preventDefault();
                    }
                });
            }

            // Featherweight background heartbeat to check if we navigated to a photo or permalink
            setInterval(() => {
                if (document.hidden) return;
                this.updateVisibility();
            }, CONFIG.timing.polling);
        }
    }

    new NavigationManager();
})();
