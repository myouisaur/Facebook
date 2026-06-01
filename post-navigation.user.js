// ==UserScript==
// @name         [Facebook] Post Navigation
// @namespace    https://github.com/myouisaur/Facebook
// @icon         https://www.facebook.com/favicon.ico
// @version      4.0
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

        offsets: { home: 60, contextual: 120 },
        thresholds: { minWidth: 300, minHeight: 250 },

        timing: {
            throttle: 150,    // Keyboard nav throttle (ms)
            cacheLife: 500    // Micro-cache lifespan for rapid-fire clicks (ms)
        },

        layout: {
            anchorBuffer: 5,
            topOfPage: 20
        },

        animation: {
            easeMultiplier: 0.3,
            minDuration: 200,
            maxDuration: 400,
            snapThreshold: 5,
            mathThrottle: 5   // Only recalculate layout every N frames
        },

        prefix: 'tm-fb-nav',
        colors: { brand: '#0866ff' },

        icons: {
            up: 'M18 15l-6-6-6 6',
            down: 'M6 9l6 6 6-6'
        }
    };

    const SETTINGS = {
        get smoothScroll() {
            try { return GM_getValue('smoothScroll', true); }
            catch (e) { return true; }
        },
        set smoothScroll(val) {
            try { GM_setValue('smoothScroll', val); }
            catch (e) { /* silent fail */ }
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
            display: none !important;
            flex-direction: column !important;
            align-items: center !important;
            gap: clamp(8px, 1.5vh, 16px) !important;
            z-index: 2147483647 !important;
            pointer-events: none !important;
        }

        .${CONFIG.prefix}-container.is-visible { display: flex !important; }

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
    // 3. LOGIC & NAV ENGINE
    // ============================================================================

    class NavigationManager {
        constructor() {
            this.containerEl = null;
            this.currentTargetNode = null;

            this.lastNavTime = 0;
            this.scrollAnimFrame = null;

            this.isAwake = false;

            // Rapid-fire micro-cache
            this.microCache = null;
            this.cacheTimer = null;

            this.registerMenu();
            this.buildUI();
            this.attachEvents();
            this.checkState();
        }

        registerMenu() {
            if (typeof GM_registerMenuCommand !== 'undefined') {
                GM_registerMenuCommand('Toggle Smooth Scrolling', () => {
                    SETTINGS.smoothScroll = !SETTINGS.smoothScroll;
                    alert(`Facebook Post Navigation:\nSmooth Scrolling is now ${SETTINGS.smoothScroll ? 'ON' : 'OFF'}.`);
                });
            }
        }

        /**
         * Evaluates the current URL path.
         */
        isPageValid() {
            const pathAndQuery = window.location.pathname + window.location.search;
            const blacklistRegex = /\/(photo|photo\.php|photos|permalink|posts|story\.php|stories|reel|watch|messages|video|videos|gaming)(\/|\?|$)/i;
            return !blacklistRegex.test(pathAndQuery);
        }

        /**
         * Core route state manager. Triggers on DOM <title> changes.
         */
        checkState() {
            if (!this.isPageValid()) {
                if (this.isAwake) this.sleep();
            } else {
                if (!this.isAwake) this.wakeUp();
            }
        }

        sleep() {
            this.isAwake = false;
            this.currentTargetNode = null;
            this.microCache = null;

            if (this.scrollAnimFrame) {
                cancelAnimationFrame(this.scrollAnimFrame);
                this.scrollAnimFrame = null;
            }

            if (this.containerEl && this.containerEl.classList.contains('is-visible')) {
                this.containerEl.classList.remove('is-visible');
            }
        }

        wakeUp() {
            this.isAwake = true;
            const posts = this.getFreshPosts();
            if (posts.length > 0 && this.containerEl && !this.containerEl.classList.contains('is-visible')) {
                this.containerEl.classList.add('is-visible');
            }
        }

        getCurrentOffset() {
            const path = window.location.pathname;
            if (path === '/' || path.startsWith('/watch') || path.startsWith('/gaming')) {
                return CONFIG.offsets.home;
            }
            return CONFIG.offsets.contextual;
        }

        /**
         * Fetches valid posts, utilizing a micro-cache to prevent CPU thrashing during rapid clicks.
         */
        getFreshPosts() {
            if (!this.isAwake) return [];

            // Return cached DOM array if user is mashing the button
            if (this.microCache) return this.microCache;

            const nodes = document.querySelectorAll(CONFIG.selectors.posts);
            const validNodes = [];
            let lastParent = null;

            for (let i = 0; i < nodes.length; i++) {
                const el = nodes[i];

                if (lastParent && lastParent.contains(el)) continue;

                const isNestedItem = el.parentElement && el.parentElement.closest(CONFIG.selectors.posts) !== null;
                if (isNestedItem) continue;

                const rect = el.getBoundingClientRect();

                if (rect.height > CONFIG.thresholds.minHeight && rect.width > CONFIG.thresholds.minWidth) {
                    validNodes.push(el);
                    lastParent = el;
                }
            }

            // Build cache and start self-destruct timer
            this.microCache = validNodes;
            clearTimeout(this.cacheTimer);
            this.cacheTimer = setTimeout(() => { this.microCache = null; }, CONFIG.timing.cacheLife);

            return validNodes;
        }

        animateScrollTo(target) {
            if (this.scrollAnimFrame) cancelAnimationFrame(this.scrollAnimFrame);

            const getTargetY = () => {
                if (typeof target === 'number') return target;
                return Math.max(0, (target.getBoundingClientRect().top + window.scrollY) - this.getCurrentOffset());
            };

            const startY = window.scrollY || window.pageYOffset;
            let dynamicTargetY = getTargetY();
            const distance = dynamicTargetY - startY;

            if (Math.abs(distance) < CONFIG.animation.snapThreshold) {
                window.scrollTo(0, dynamicTargetY);
                this.scrollAnimFrame = null;
                return;
            }

            const duration = Math.min(
                CONFIG.animation.maxDuration,
                Math.max(CONFIG.animation.minDuration, Math.abs(distance) * CONFIG.animation.easeMultiplier)
            );

            let startTime = null;
            let frameCount = 0;

            const step = (currentTime) => {
                if (!this.isAwake) { this.scrollAnimFrame = null; return; }
                if (!startTime) startTime = currentTime;

                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const ease = progress * (2 - progress);

                // THROTTLED MATH: Only recalculate layout geometry every N frames
                if (frameCount % CONFIG.animation.mathThrottle === 0) {
                    dynamicTargetY = getTargetY();
                }
                frameCount++;

                const dynamicDistance = dynamicTargetY - startY;
                window.scrollTo(0, startY + (dynamicDistance * ease));

                if (progress < 1) {
                    this.scrollAnimFrame = requestAnimationFrame(step);
                } else {
                    window.scrollTo(0, dynamicTargetY);
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
            if (!this.isAwake) return false;

            const now = Date.now();
            if (now - this.lastNavTime < CONFIG.timing.throttle) return false;
            this.lastNavTime = now;

            const posts = this.getFreshPosts();
            if (!posts.length) return false;

            let targetNode = null;

            if (this.currentTargetNode && document.body.contains(this.currentTargetNode)) {
                const currentIndex = posts.indexOf(this.currentTargetNode);
                if (currentIndex !== -1) {
                    const nextIndex = direction === 'down' ? currentIndex + 1 : currentIndex - 1;
                    if (posts[nextIndex]) targetNode = posts[nextIndex];
                }
            }

            if (!targetNode) {
                const currentOffset = this.getCurrentOffset();
                const anchorDown = currentOffset + CONFIG.layout.anchorBuffer;
                const anchorUp = currentOffset - CONFIG.layout.anchorBuffer;

                if (direction === 'down') {
                    targetNode = posts.find(post => post.getBoundingClientRect().top > anchorDown);
                } else if (direction === 'up') {
                    targetNode = [...posts].reverse().find(post => post.getBoundingClientRect().top < anchorUp);

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

        buildUI() {
            this.containerEl = document.createElement('div');
            this.containerEl.className = `${CONFIG.prefix}-container`;
            this.containerEl.id = `${CONFIG.prefix}-main`;
            this.containerEl.setAttribute('aria-label', 'Post Navigation');

            this.containerEl.innerHTML = `
                <button class="${CONFIG.prefix}-btn" id="${CONFIG.prefix}-up" aria-label="Previous Post" title="Previous Post (Arrow Up)">
                    <svg viewBox="0 0 24 24"><path d="${CONFIG.icons.up}"></path></svg>
                </button>
                <button class="${CONFIG.prefix}-btn" id="${CONFIG.prefix}-down" aria-label="Next Post" title="Next Post (Arrow Down)">
                    <svg viewBox="0 0 24 24"><path d="${CONFIG.icons.down}"></path></svg>
                </button>
            `;

            this.containerEl.querySelector(`#${CONFIG.prefix}-up`).addEventListener('click', (e) => { e.preventDefault(); this.navigate('up'); });
            this.containerEl.querySelector(`#${CONFIG.prefix}-down`).addEventListener('click', (e) => { e.preventDefault(); this.navigate('down'); });

            document.body.appendChild(this.containerEl);
        }

        attachEvents() {
            const abortScroll = () => {
                if (this.scrollAnimFrame) {
                    cancelAnimationFrame(this.scrollAnimFrame);
                    this.scrollAnimFrame = null;
                }
                this.currentTargetNode = null;
            };

            // Consolidate manual override listeners
            ['wheel', 'touchstart'].forEach(evt => window.addEventListener(evt, abortScroll, { passive: true }));

            if (CONFIG.enableKeyboard) {
                window.addEventListener('keydown', (e) => {
                    if (!this.isAwake || e.repeat) return;

                    const activeEl = document.activeElement;
                    if (activeEl) {
                        const tag = activeEl.tagName;
                        const role = activeEl.getAttribute('role');
                        const isTextInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
                        const isRichText = activeEl.isContentEditable || e.target.closest('[contenteditable="true"]');
                        const isAriaInput = role === 'textbox' || role === 'combobox';

                        if (isTextInput || isRichText || isAriaInput) {
                            // INPUT THEFT: If the box is completely empty, blur it and let the user scroll anyway
                            const val = activeEl.value || activeEl.textContent;
                            if (!val.trim() && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                                activeEl.blur();
                            } else {
                                return; // User is actually typing, back off
                            }
                        }
                    }

                    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;

                    let direction = null;
                    if (e.key === 'ArrowUp') direction = 'up';
                    if (e.key === 'ArrowDown') direction = 'down';

                    if (direction && this.navigate(direction)) {
                        e.preventDefault();
                    }
                });
            }

            // Zero-CPU Routing: Watch Facebook's <head> tag for <title> changes
            const head = document.querySelector('head');
            if (head) {
                new MutationObserver(() => this.checkState()).observe(head, { childList: true, subtree: true });
            }
        }
    }

    new NavigationManager();
})();
