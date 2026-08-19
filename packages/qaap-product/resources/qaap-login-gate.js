/**
 * Qaap sign-in gate — runs before bundle.js (injected via index.html).
 * Blocks IDE startup until GitHub is chosen.
 */
(function () {
    'use strict';

    /**
     * Qaap is an English-language product. Theia persists display-language choices in
     * `localeId`; normalize it before bundle.js evaluates `nls.locale`.
     */
    (function enforceEnglishInterface() {
        try {
            window.localStorage.setItem('localeId', 'en');
        } catch (e) { /* storage may be unavailable */ }
        document.documentElement.setAttribute('lang', 'en');
    })();

    /**
     * Mobile Work Hub boot guard — runs before bundle.js so the IDE shell never flashes
     * behind the Agents chat while layout + workspace restore finish loading.
     * Mirrors installMobileWorkHubBootGuard() in @theia/qaap-mobile-shell.
     */
    (function installMobileWorkHubBootGuardEarly() {
        try {
            if (!window.sessionStorage) {
                return;
            }
            var ss = window.sessionStorage;
            var preferDesktopIde = ss.getItem('qaap.mobileProjects.preferDesktopIde') === '1'
                || ss.getItem('qaap.mobileProjects.explicitDesktopIde') === '1';
            if (preferDesktopIde) {
                return;
            }
            // NOTE: `homeVisible` is NOT a skip — the Work Hub Home is a hub surface, so on reload
            // we must keep hiding the IDE until the hub home mounts (applyLandingChrome releases it).
            if (ss.getItem('qaap.hub.pendingAction')) {
                return;
            }
            var hash = (window.location.hash || '').replace(/^#/, '').trim();
            var hasWorkspace = hash.length > 0 && hash !== '/';
            var dismiss = ss.getItem('qaap.mobileProjects.dismissPanel') === '1';
            var preferAgents = ss.getItem('qaap.mobileProjects.preferAgentsSurface') === '1';
            // Pre-hide IDE chrome while the Work Hub / Agents surface mounts.
            // Apply on every viewport: Work Hub is the default surface on every boot unless
            // the user explicitly chose the classic IDE in this tab.
            document.body.classList.add('theia-mobile-mod-workhub-composer-header');
            document.body.classList.add('theia-mobile-mod-workhub-hide-ide-side-panels');
            // Boot guard: hide the IDE shell until the Work Hub mounts so it never flashes first.
            // This applies unconditionally — Work Hub is the default surface on every boot,
            // even when sessionStorage is empty (e.g. after clearing cookies). The guard is
            // lifted by the TypeScript shell once Work Hub or the Agents surface is ready, or
            // by the 8-second safety timeout below.
            if (!document.getElementById('qaap-mobile-workhub-boot-styles')) {
                var style = document.createElement('style');
                style.id = 'qaap-mobile-workhub-boot-styles';
                style.textContent = [
                    'html.theia-mobile-workhub-boot,html.theia-mobile-workhub-boot body{',
                    'background:#f5f5f5!important;background:var(--q-bg,var(--qaap-bg,#f5f5f5))!important}',
                    'html.theia-mobile-workhub-boot #theia-app-shell,',
                    'html.theia-mobile-workhub-boot #theia-top-panel,',
                    'html.theia-mobile-workhub-boot #theia-left-content-panel,',
                    'html.theia-mobile-workhub-boot #theia-right-content-panel,',
                    'html.theia-mobile-workhub-boot #theia-bottom-content-panel,',
                    'html.theia-mobile-workhub-boot #theia-bottom-split-panel,',
                    'html.theia-mobile-workhub-boot .theia-mobile-workbench-top-bar,',
                    'html.theia-mobile-workhub-boot .theia-mobile-bottom-chrome-host,',
                    'html.theia-mobile-workhub-boot #theia-statusBar,',
                    'html.theia-mobile-workhub-boot .theia-mobile-bottom-bar,',
                    'html.theia-mobile-workhub-boot #theia-app-shell.theia-mod-mobile-one-column #theia-main-content-panel,',
                    'body.theia-mobile-mod-workhub-composer-header #theia-main-content-panel,',
                    'body.theia-mobile-mod-workhub-composer-header #theia-top-panel,',
                    'body.theia-mobile-mod-workhub-composer-header #theia-left-content-panel,',
                    'body.theia-mobile-mod-workhub-composer-header #theia-right-content-panel,',
                    'body.theia-mobile-mod-workhub-composer-header #theia-bottom-content-panel,',
                    'body.theia-mobile-mod-workhub-composer-header #theia-bottom-split-panel,',
                    'body.theia-mobile-mod-workhub-hide-ide-side-panels #theia-left-content-panel,',
                    'body.theia-mobile-mod-workhub-hide-ide-side-panels #theia-right-content-panel,',
                    'body.theia-mobile-mod-workhub-hide-ide-side-panels #theia-bottom-content-panel,',
                    'body.theia-mobile-mod-workhub-hide-ide-side-panels #theia-bottom-split-panel{',
                    'visibility:hidden!important;pointer-events:none!important}'
                ].join('');
                (document.head || document.documentElement).appendChild(style);
            }
            document.documentElement.classList.add('theia-mobile-workhub-boot');
            // Safety net: never leave the shell hidden if the hub fails to mount for any reason.
            // Only lift the html boot guard — body classes are owned by @theia/qaap-mobile-shell and
            // must stay active while Work Hub is the surface (stripping them leaks Explorer).
            window.setTimeout(function () {
                document.documentElement.classList.remove('theia-mobile-workhub-boot');
            }, 8000);
        } catch (e) { /* ignore */ }
    })();

    var SIGNED_IN_SUFFIX = 'qaap.auth.signedIn';
    var PROVIDER_SUFFIX = 'qaap.auth.provider';
    var USER_SUFFIX = 'qaap.auth.user';
    // Legacy key, purged on every sign-in write: the session id must never live in
    // localStorage (XSS could exfiltrate it) — the HttpOnly cookie is the only credential.
    var LEGACY_SESSION_ID_SUFFIX = 'qaap.auth.sessionId';
    var AUTH_MS = 1200;

    function storagePrefix() {
        var pathname = window.location.pathname || '/';
        return 'theia:' + pathname + ':';
    }

    function isSignedIn() {
        try {
            // Fast path: the common case is a reload of the same workspace, so the signed-in
            // flag lives under the current pathname prefix. Avoids iterating all of localStorage
            // (and JSON.parse on every match) before the first paint.
            var directRaw = localStorage.getItem(storagePrefix() + SIGNED_IN_SUFFIX);
            if (directRaw !== null) {
                var directValue = JSON.parse(directRaw);
                if (directValue === true || directValue === 'true') {
                    return true;
                }
            }
            // Fallback: the user may be signed in under a different workspace prefix.
            var i, key, raw, value;
            for (i = 0; i < localStorage.length; i++) {
                key = localStorage.key(i);
                if (key && key.indexOf(SIGNED_IN_SUFFIX) !== -1) {
                    raw = localStorage.getItem(key);
                    if (raw === null) {
                        continue;
                    }
                    value = JSON.parse(raw);
                    if (value === true || value === 'true') {
                        return true;
                    }
                }
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    function clearStaleAuthLocalStorage() {
        try {
            var keysToRemove = [];
            var k, storageKey;
            for (k = 0; k < localStorage.length; k++) {
                storageKey = localStorage.key(k);
                if (storageKey && storageKey.indexOf('qaap.auth') !== -1) {
                    keysToRemove.push(storageKey);
                }
            }
            for (k = 0; k < keysToRemove.length; k++) {
                localStorage.removeItem(keysToRemove[k]);
            }
        } catch (e) { /* ignore */ }
    }

    function purgeLegacySessionIdKeys() {
        try {
            var stale = [];
            var i, key;
            for (i = 0; i < localStorage.length; i++) {
                key = localStorage.key(i);
                if (key && key.indexOf(LEGACY_SESSION_ID_SUFFIX) !== -1) {
                    stale.push(key);
                }
            }
            for (i = 0; i < stale.length; i++) {
                localStorage.removeItem(stale[i]);
            }
        } catch (e) { /* ignore */ }
    }

    function writeSignedIn(provider, user) {
        var prefix = storagePrefix();
        purgeLegacySessionIdKeys();
        localStorage.setItem(prefix + SIGNED_IN_SUFFIX, JSON.stringify(true));
        localStorage.setItem(prefix + PROVIDER_SUFFIX, JSON.stringify(provider));
        if (user) {
            localStorage.setItem(prefix + USER_SUFFIX, JSON.stringify(user));
        }
    }

    // Watchdog: if bundle.js never loads (network error, stale SW chunk mismatch)
    // show an error + retry UI so the user is never stuck on a blank spinner.
    var bundleLoadWatchdog = window.setTimeout(function () {
        if (!window.__qaapBundleLoaded) {
            console.warn('[Qaap] bundle.js slow or failed — check network / console');
            showStartupError('bundle');
        }
    }, 30000);

    // Startup watchdog: bundle loaded but Theia DI/startup never completed.
    // Arms after bundle.js executes; fires if the splash is still visible 30s later.
    var startupWatchdog = null;

    // The product shell can become usable before the legacy Theia preload node
    // finishes its own transition. Let the app explicitly dismiss this watchdog
    // so a slow paint cannot cover a ready Work Hub with a retry dialog.
    function markStartupReady() {
        if (startupWatchdog) {
            window.clearTimeout(startupWatchdog);
            startupWatchdog = null;
        }
        var startupError = document.getElementById('qaap-startup-error');
        if (startupError) {
            startupError.remove();
        }
    }
    window.addEventListener('qaap-startup-ready', markStartupReady);

    function armStartupWatchdog() {
        if (startupWatchdog) { return; }
        startupWatchdog = window.setTimeout(function () {
            var preload = document.querySelector('.theia-preload');
            var isVisible = preload && preload.style.display !== 'none' &&
                !preload.classList.contains('theia-hidden') &&
                preload.offsetParent !== null;
            if (isVisible) {
                console.warn('[Qaap] Theia startup timed out — showing retry UI');
                showStartupError('startup');
            }
        }, 30000);
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    function showStartupError(kind) {
        // Don't show if login gate is already visible or IDE already loaded.
        if (document.getElementById('qaap-login-host') ||
            document.getElementById('qaap-startup-error')) { return; }

        var name = appName();
        var msg = kind === 'bundle'
            ? 'The application bundle could not load. Check your connection.'
            : 'The application took too long to start.';

        injectErrorStyles();
        var host = document.createElement('div');
        host.id = 'qaap-startup-error';
        host.setAttribute('role', 'alertdialog');
        host.setAttribute('aria-live', 'assertive');
        host.setAttribute('aria-modal', 'true');
        host.setAttribute('aria-labelledby', 'qaap-err-name');
        host.setAttribute('aria-describedby', 'qaap-err-message');
        host.innerHTML =
            '<div class="qaap-err-overlay">' +
            '<div class="qaap-err-box">' +
            '<div class="qaap-err-icon" aria-hidden="true">&#9888;</div>' +
            '<p id="qaap-err-name" class="qaap-err-name">' + escapeHtml(name) + '</p>' +
            '<p id="qaap-err-message" class="qaap-err-msg">' + escapeHtml(msg) + '</p>' +
            '<button type="button" id="qaap-err-retry" class="qaap-err-btn">Retry</button>' +
            '</div></div>';
        document.body.appendChild(host);

        var btn = document.getElementById('qaap-err-retry');
        if (btn) {
            btn.addEventListener('click', function () {
                window.location.reload();
            });
            btn.focus();
        }
    }

    function injectErrorStyles() {
        if (document.getElementById('qaap-err-styles')) { return; }
        var style = document.createElement('style');
        style.id = 'qaap-err-styles';
        style.textContent =
            '#qaap-startup-error{position:fixed;inset:0;z-index:2147483646;display:flex;' +
            'align-items:center;justify-content:center;background:rgba(0,0,0,.55)}' +
            '.qaap-err-overlay{display:flex;align-items:center;justify-content:center;width:100%;height:100%}' +
            '.qaap-err-box{background:#fff;border-radius:14px;padding:32px 28px;max-width:320px;width:90%;' +
            'text-align:center;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 8px 40px rgba(0,0,0,.25)}' +
            '@media(prefers-color-scheme:dark){.qaap-err-box{background:#1e1e1e;color:#f5f5f5}}' +
            '.qaap-err-icon{font-size:40px;margin-bottom:12px}' +
            '.qaap-err-name{margin:0 0 6px;font-size:18px;font-weight:700}' +
            '.qaap-err-msg{margin:0 0 20px;font-size:14px;line-height:1.45;color:#666}' +
            '@media(prefers-color-scheme:dark){.qaap-err-msg{color:#a0a0a0}}' +
            '.qaap-err-btn{width:100%;height:44px;border-radius:10px;border:none;cursor:pointer;' +
            'background:#0969da;color:#fff;font-size:15px;font-weight:600;font-family:inherit}' +
            '.qaap-err-btn:active{opacity:.85}';
        document.head.appendChild(style);
    }

    function loadBundle() {
        if (window.__qaapBundleLoading || window.__qaapBundleLoaded) {
            return;
        }
        window.__qaapBundleLoading = true;
        var script = document.createElement('script');
        // The frontend builds as ES modules (esbuild code-splitting); the
        // browser resolves and parallel-loads the shared chunks itself.
        script.type = 'module';
        script.charset = 'utf-8';
        script.src = './bundle.js';
        script.onload = function () {
            window.__qaapBundleLoaded = true;
            window.clearTimeout(bundleLoadWatchdog);
            armStartupWatchdog();
        };
        script.onerror = function () {
            window.__qaapBundleLoading = false;
            console.error('[Qaap] Failed to load application bundle.');
            showStartupError('bundle');
        };
        document.body.appendChild(script);
    }

    function appName() {
        var meta = document.querySelector('meta[name="application-name"]');
        return (meta && meta.getAttribute('content') && meta.getAttribute('content').trim()) || 'Qaap';
    }

    function logoUrl() {
        var meta = document.querySelector('meta[name="application-icon"]');
        return (meta && meta.getAttribute('content') && meta.getAttribute('content').trim()) || './media/qaap-logo.svg';
    }

    var GITHUB_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>';

    function injectStyles() {
        if (document.getElementById('qaap-login-gate-styles')) {
            return;
        }
        var style = document.createElement('style');
        style.id = 'qaap-login-gate-styles';
        style.textContent = [
            'body.qaap-login-active{overflow:hidden;margin:0}',
            'body.qaap-login-active .theia-preload{display:none!important}',
            '#qaap-login-host{--qaap-ink:#1a1a1a;--qaap-surface:#fff;--qaap-muted:#6b6b6b;--qaap-border:#e2e2e2;--qaap-link:#0969da;',
            'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;font-family:system-ui,-apple-system,sans-serif}',
            '@media (prefers-color-scheme:dark){#qaap-login-host{--qaap-ink:#f5f5f5;--qaap-surface:#1e1e1e;--qaap-muted:#a0a0a0;--qaap-border:#3c3c3c;--qaap-link:#58a6ff}}',
            '.qaap-login-overlay{flex:1;display:flex;flex-direction:column;padding:32px 24px 24px;background:var(--qaap-surface);color:var(--qaap-ink);box-sizing:border-box}',
            '.qaap-login-brand{display:flex;flex-direction:column;align-items:center;gap:14px;margin-top:24px}',
            '.qaap-login-logo{width:64px;height:64px;object-fit:contain}',
            '.qaap-login-title{margin:0;font-size:30px;font-weight:700;letter-spacing:-.8px}',
            '.qaap-login-tagline{margin:0;max-width:280px;font-size:14px;line-height:1.45;text-align:center;color:var(--qaap-muted)}',
            '.qaap-login-spacer{flex:1;min-height:24px}',
            '.qaap-login-actions{display:flex;flex-direction:column;gap:10px}',
            '.qaap-login-btn{width:100%;min-height:44px;height:48px;border-radius:10px;cursor:pointer;font:inherit;font-size:15px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:10px;touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
            '.qaap-login-btn--primary{border:none;background:var(--qaap-ink);color:var(--qaap-surface)}',
            '.qaap-login-btn--secondary{height:44px;border:1px solid var(--qaap-border);background:transparent;color:var(--qaap-ink);font-size:14px;font-weight:500}',
            '.qaap-login-btn:disabled{opacity:.85;cursor:not-allowed}',
            '.qaap-login-btn[aria-busy="true"]{cursor:wait}',
            '.qaap-login-btn:focus-visible{outline:2px solid var(--qaap-link);outline-offset:2px}',
            '.qaap-login-btn-icon{display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center}',
            '.qaap-login-spinner{width:16px;height:16px;border-radius:50%;border:2px solid color-mix(in srgb,currentColor 35%,transparent);border-top-color:currentColor;animation:qaap-spin .8s linear infinite}',
            '@keyframes qaap-spin{to{transform:rotate(360deg)}}',
            '.qaap-login-status{min-height:1.45em;margin:10px 0 0;font-size:12px;line-height:1.45;text-align:center;color:var(--qaap-muted)}',
            '.qaap-login-footer{margin-top:20px;font-size:11.5px;line-height:1.5;text-align:center;color:var(--qaap-muted)}',
            '.qaap-login-footer a{color:var(--qaap-link);text-decoration:none}',
            '.qaap-login-footer a:focus-visible{outline:2px solid var(--qaap-link);outline-offset:2px;border-radius:2px}',
            '@media(prefers-reduced-motion:reduce){.qaap-login-btn{transition:none}.qaap-login-btn:active{transform:none}.qaap-login-spinner{animation:none}}'
        ].join('');
        document.head.appendChild(style);
    }

    function showGate() {
        injectStyles();
        document.body.classList.add('qaap-login-active');

        var host = document.createElement('div');
        host.id = 'qaap-login-host';
        host.setAttribute('role', 'dialog');
        host.setAttribute('aria-modal', 'true');
        host.setAttribute('aria-labelledby', 'qaap-login-title');
        host.setAttribute('aria-describedby', 'qaap-login-description');
        host.tabIndex = -1;
        host.innerHTML =
            '<div class="qaap-login-overlay">' +
            '<header class="qaap-login-brand">' +
            '<img class="qaap-login-logo" src="' + logoUrl() + '" width="64" height="64" alt=""/>' +
            '<h1 id="qaap-login-title" class="qaap-login-title">' + appName() + '</h1>' +
            '<p id="qaap-login-description" class="qaap-login-tagline">A pocket workspace for coding agents.<br/>Sign in to connect your repos.</p>' +
            '</header>' +
            '<div class="qaap-login-spacer"></div>' +
            '<div class="qaap-login-actions">' +
            '<button type="button" id="qaap-login-github" class="qaap-login-btn qaap-login-btn--primary">' +
            '<span class="qaap-login-btn-icon">' + GITHUB_SVG + '</span><span class="qaap-login-btn-label">Sign in with GitHub</span></button>' +
            '</div>' +
            '<p id="qaap-login-status" class="qaap-login-status" role="status" aria-live="polite" aria-atomic="true"></p>' +
            '<footer class="qaap-login-footer">By continuing you agree to the <a href="/legal/terms.html">terms</a> &amp; <a href="/legal/privacy.html">privacy</a>.</footer>' +
            '</div>';

        document.body.appendChild(host);

        var preloadEls = document.getElementsByClassName('theia-preload');
        for (var p = 0; p < preloadEls.length; p++) {
            preloadEls[p].style.display = 'none';
        }

        function authorize(button) {
            if (button.disabled) {
                return;
            }
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            var label = button.querySelector('.qaap-login-btn-label');
            if (label) {
                label.textContent = 'Authorizing…';
            }
            var status = host.querySelector('#qaap-login-status');
            if (status) {
                status.textContent = 'Opening GitHub sign-in…';
            }
            // Full-page redirect to GitHub OAuth; the session lands after the callback.
            try {
                window.history.replaceState({}, '', window.location.pathname + window.location.search);
            } catch (e) { /* ignore */ }
            window.location.href = '/qaap/oauth/github/start';
        }

        var github = document.getElementById('qaap-login-github');
        if (github) {
            github.addEventListener('click', function (e) {
                e.preventDefault();
                authorize(github);
            });
            github.focus();
        }

        host.addEventListener('keydown', function (event) {
            if (event.key !== 'Tab') {
                return;
            }
            var focusable = Array.prototype.slice.call(host.querySelectorAll(
                'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
            ));
            if (!focusable.length) {
                event.preventDefault();
                host.focus();
                return;
            }
            var first = focusable[0];
            var last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });

        // If the server has no GitHub OAuth app configured, a click would land on a raw 503 page.
        // Detect that and disable the button with an explanation instead (ONB-1).
        reflectGithubAvailability(host);
    }

    function reflectGithubAvailability(host) {
        fetchWithTimeout('/qaap/api/auth/config', { credentials: 'include' }, 4000)
            .then(function (res) { return res && res.ok ? res.json() : null; })
            .then(function (config) {
                // Only disable when the server AFFIRMATIVELY reports no OAuth app. On a fetch
                // error/timeout (config === null) leave the button enabled — a transient blip must
                // never lock out a working login.
                if (!config || config.githubOAuth === true || config.skipAuth === true) {
                    return;
                }
                var button = document.getElementById('qaap-login-github');
                if (button) {
                    button.disabled = true;
                    button.setAttribute('aria-disabled', 'true');
                    button.classList.add('qaap-login-btn--unavailable');
                    var label = button.querySelector('.qaap-login-btn-label');
                    if (label) {
                        label.textContent = 'GitHub sign-in unavailable';
                    }
                }
                var status = host.querySelector('#qaap-login-status');
                if (status) {
                    status.textContent = 'GitHub sign-in isn’t configured on this server yet. '
                        + 'Ask the administrator to set the GitHub OAuth credentials or enable QAAP_SKIP_AUTH for local use.';
                }
            })
            .catch(function () { /* config unknown (timeout/error) — leave the button enabled */ });
    }

    if (window.location.search.indexOf('qaapLogout=1') !== -1) {
        try {
            var keysToRemove = [];
            for (var k = 0; k < localStorage.length; k++) {
                var storageKey = localStorage.key(k);
                if (storageKey && storageKey.indexOf('qaap.auth') !== -1) {
                    keysToRemove.push(storageKey);
                }
            }
            for (var r = 0; r < keysToRemove.length; r++) {
                localStorage.removeItem(keysToRemove[r]);
            }
        } catch (e) { /* ignore */ }
    }

    function fetchWithTimeout(url, options, timeoutMs) {
        return Promise.race([
            fetch(url, options),
            new Promise(function (_resolve, reject) {
                window.setTimeout(function () { reject(new Error('timeout')); }, timeoutMs);
            }),
        ]);
    }

    function resumeAfterOAuthOrSession() {
        if (window.location.search.indexOf('qaap_oauth_error=1') !== -1) {
            try {
                var errParams = new URLSearchParams(window.location.search);
                var reason = errParams.get('qaap_oauth_reason');
                console.error('[Qaap] GitHub OAuth callback failed.', reason ? 'Reason: ' + reason : '(no reason provided by backend)');
            } catch (e) { /* ignore */ }
        }
        if (window.location.search.indexOf('qaap_oauth=github') !== -1) {
            fetchWithTimeout('/qaap/api/auth/session', { credentials: 'include' }, 12000)
                .then(function (response) {
                    if (!response.ok) {
                        throw new Error('session');
                    }
                    return response.json();
                })
                .then(function (data) {
                    if (data && data.signedIn && data.user && data.user.provider) {
                        writeSignedIn(data.user.provider, data.user);
                    }
                    document.body.classList.remove('qaap-login-active');
                    var host = document.getElementById('qaap-login-host');
                    if (host) {
                        host.remove();
                    }
                    var next = new URL(window.location.href);
                    next.searchParams.delete('qaap_oauth');
                    next.searchParams.delete('qaap_oauth_error');
                    var clean = next.pathname + next.search + (next.hash || '');
                    window.history.replaceState({}, '', clean);
                    loadBundle();
                })
                .catch(function () {
                    clearStaleAuthLocalStorage();
                    if (document.body) {
                        showGate();
                    } else {
                        document.addEventListener('DOMContentLoaded', showGate);
                    }
                });
            return;
        }
        fetchWithTimeout('/qaap/api/auth/session', { credentials: 'include' }, 12000)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('session');
                }
                return response.json();
            })
            .then(function (data) {
                if (data && data.signedIn && data.user && data.user.provider) {
                    writeSignedIn(data.user.provider, data.user);
                    loadBundle();
                    return;
                }
                throw new Error('unsigned');
            })
            .catch(function (err) {
                console.warn('[Qaap] session check failed, showing login gate', err && err.message);
                if (document.body) {
                    showGate();
                } else {
                    document.addEventListener('DOMContentLoaded', showGate);
                }
            });
    }

    function trySkipAuthDevMode() {
        return fetchWithTimeout('/qaap/api/auth/config', { credentials: 'include' }, 8000)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('config');
                }
                return response.json();
            })
            .then(function (config) {
                if (config && config.skipAuth) {
                    writeSignedIn('gitlab', {
                        provider: 'gitlab',
                        login: 'gitlab-user',
                        name: 'GitLab User',
                    });
                    loadBundle();
                    return true;
                }
                return false;
            });
    }

    function verifyStoredSessionThenLoad() {
        fetchWithTimeout('/qaap/api/auth/session', { credentials: 'include' }, 12000)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('session');
                }
                return response.json();
            })
            .then(function (data) {
                if (data && data.signedIn && data.user && data.user.provider) {
                    writeSignedIn(data.user.provider, data.user);
                    loadBundle();
                    return;
                }
                throw new Error('unsigned');
            })
            .catch(function () {
                if (isSignedIn()) {
                    clearStaleAuthLocalStorage();
                }
                trySkipAuthDevMode().then(function (skipped) {
                    if (!skipped) {
                        if (document.body) {
                            showGate();
                        } else {
                            document.addEventListener('DOMContentLoaded', showGate);
                        }
                    }
                }).catch(function () {
                    if (document.body) {
                        showGate();
                    } else {
                        document.addEventListener('DOMContentLoaded', showGate);
                    }
                });
            });
    }

    // Speculatively preload bundle.js while the auth check is in flight.
    // On a warm session the user is signed in — the bundle starts downloading
    // immediately instead of waiting for the /auth/session round-trip.
    // On a cold session the preload is wasted bandwidth, but the login gate
    // is shown quickly (it has its own inline CSS) so the UX is still fast.
    function speculativePreloadBundle() {
        try {
            var link = document.createElement('link');
            link.rel = 'modulepreload';
            link.href = './bundle.js';
            link.as = 'script';
            link.crossOrigin = 'anonymous';
            (document.head || document.documentElement).appendChild(link);
        } catch (_) { /* ignore */ }
    }

    if (window.location.search.indexOf('qaap_oauth=github') !== -1
        || window.location.search.indexOf('qaap_oauth_error=1') !== -1) {
        speculativePreloadBundle();
        resumeAfterOAuthOrSession();
    } else if (isSignedIn()) {
        speculativePreloadBundle();
        verifyStoredSessionThenLoad();
    } else {
        trySkipAuthDevMode().then(function (skipped) {
            if (!skipped) {
                resumeAfterOAuthOrSession();
            } else {
                speculativePreloadBundle();
            }
        }).catch(function () {
            resumeAfterOAuthOrSession();
        });
    }
})();
