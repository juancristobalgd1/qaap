/**
 * Qaap sign-in gate — runs before bundle.js (injected via index.html).
 * Keeps the login surface in front of the IDE while authentication is resolved.
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

    /** Set when this tab reloads into the classic IDE; the IDE never reads Work Hub data at boot. */
    var bootsIntoIde = false;
    /** Set when the boot guard below hid the IDE shell for the Work Hub. */
    var workHubBootGuardInstalled = false;
    /** Mobile one-column viewport at boot: the IDE shell is never revealed, only Work Hub. */
    var mobileBootMode = false;

    // ---------------------------------------------------------------------------------------
    // Boot timings. `performance.now()` is relative to navigation start, so every mark is the
    // time since the user opened the app. Marks are also emitted as `performance.mark()` with
    // the `qaap-boot:` prefix for DevTools. Nothing here may ever throw.
    // ---------------------------------------------------------------------------------------
    var BOOT_MARK_PREFIX = 'qaap-boot:';
    var BOOT_TIMINGS_STORAGE_KEY = 'qaap.boot.lastTimings';
    var bootMarks = {};
    var bootTimingsReported = false;
    var bootEntry;
    var bootShellSnapshotPainted = false;
    var bootRuntimeCold = false;

    function bootNow() {
        try {
            if (window.performance && typeof window.performance.now === 'function') {
                return window.performance.now();
            }
        } catch (e) { /* fall through */ }
        return Date.now();
    }

    /** Record the first occurrence of a boot milestone. */
    function bootMark(name) {
        try {
            if (bootMarks[name] !== undefined) {
                return;
            }
            bootMarks[name] = Math.round(bootNow());
            if (window.performance && typeof window.performance.mark === 'function') {
                window.performance.mark(BOOT_MARK_PREFIX + name);
            }
        } catch (e) { /* instrumentation must never break boot */ }
    }

    function bootDelta(from, to) {
        return bootMarks[from] !== undefined && bootMarks[to] !== undefined ? bootMarks[to] - bootMarks[from] : undefined;
    }

    /** On the first `qaap-startup-ready`: one console line, `window.__qaapBootTimings`, sessionStorage. */
    function reportBootTimings() {
        if (bootTimingsReported) {
            return;
        }
        bootTimingsReported = true;
        try {
            bootMark('startup-ready');
            var marks = {};
            var name;
            for (name in bootMarks) {
                if (Object.prototype.hasOwnProperty.call(bootMarks, name)) {
                    marks[name] = bootMarks[name];
                }
            }
            var summary = {
                v: 1,
                recordedAt: Date.now(),
                marks: marks,
                deltas: {
                    sessionCheck: bootDelta('gate-start', 'session-verified'),
                    bundleLoad: bootDelta('bundle-requested', 'bundle-loaded'),
                    bundleToReady: bootDelta('bundle-loaded', 'startup-ready'),
                    total: bootDelta('gate-start', 'startup-ready')
                },
                entry: bootEntry,
                mobile: mobileBootMode,
                shellSnapshot: bootShellSnapshotPainted,
                runtimeCold: bootRuntimeCold
            };
            window.__qaapBootTimings = summary;
            var parts = [];
            for (name in marks) {
                if (Object.prototype.hasOwnProperty.call(marks, name)) {
                    parts.push(name + '=' + marks[name]);
                }
            }
            console.info('[qaap-boot] ms since navigation: ' + parts.join(' ')
                + ' | entry=' + (bootEntry || '-') + ' shell=' + (bootShellSnapshotPainted ? 'snapshot' : 'none')
                + ' cold=' + (bootRuntimeCold ? 'yes' : 'no'));
            try {
                window.sessionStorage.setItem(BOOT_TIMINGS_STORAGE_KEY, JSON.stringify(summary));
            } catch (e) { /* storage may be unavailable */ }
        } catch (e) { /* instrumentation must never break boot */ }
    }

    bootMark('gate-start');

    var BOOT_PLACEHOLDER_ID = 'qaap-mobile-workhub-connecting';
    var BOOT_PLACEHOLDER_LABEL_CLASS = 'qaap-mobile-workhub-connecting-label';
    var APPEARANCE_MODE_KEY = 'qaap.appearance.mode';

    /** 'light' | 'dark' when the user (or the Work Hub snapshot) pinned one; otherwise follow the OS. */
    function resolveBootTheme(preferred) {
        if (preferred === 'light' || preferred === 'dark') {
            return preferred;
        }
        try {
            var mode = window.localStorage.getItem(APPEARANCE_MODE_KEY);
            if (mode === 'light' || mode === 'dark') {
                return mode;
            }
        } catch (e) { /* ignore */ }
        return undefined;
    }

    function injectBootPlaceholderStyles() {
        if (!document.getElementById('qaap-mobile-workhub-connecting-styles')) {
            var style = document.createElement('style');
            style.id = 'qaap-mobile-workhub-connecting-styles';
            style.textContent = [
                '#qaap-mobile-workhub-connecting{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;',
                'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;',
                'background:#f5f5f5;background:var(--q-bg,var(--qaap-bg,#f5f5f5));',
                'color:#6b6b6b;font:500 14px/1.4 system-ui,-apple-system,sans-serif}',
                '#qaap-mobile-workhub-connecting .qaap-mobile-workhub-connecting-logo{width:64px;height:64px;',
                'background:var(--theia-workbench-brand-logo-url,none) center/contain no-repeat}'
            ].join('');
            (document.head || document.documentElement).appendChild(style);
        }
        if (!document.getElementById('qaap-boot-shell-styles')) {
            var shellStyle = document.createElement('style');
            shellStyle.id = 'qaap-boot-shell-styles';
            // Mirrors the mobile Work Hub home (header, empty state, quick actions, composer) so
            // the real Work Hub replaces it in place; values that depend on loaded data are
            // shimmering skeleton bars. Colors follow the Qaap light / dark product theme.
            shellStyle.textContent = [
                '#qaap-mobile-workhub-connecting{--qaap-boot-bg:#f6f5f1;--qaap-boot-ink:#111;--qaap-boot-muted:#8a8a8a;',
                '--qaap-boot-card:#fdfbf8;--qaap-boot-border:rgba(17,17,17,.08);--qaap-boot-tray:#dfddda;',
                '--qaap-boot-sk:rgba(17,17,17,.07);--qaap-boot-sk-hi:rgba(17,17,17,.13)}',
                '#qaap-mobile-workhub-connecting.qaap-boot-theme-dark{--qaap-boot-bg:#000;--qaap-boot-ink:#fff;',
                '--qaap-boot-muted:rgba(255,255,255,.7);--qaap-boot-card:#000;--qaap-boot-border:rgba(255,255,255,.08);',
                '--qaap-boot-tray:#000;--qaap-boot-sk:rgba(255,255,255,.08);--qaap-boot-sk-hi:rgba(255,255,255,.16);',
                'background:#000;color:rgba(255,255,255,.7)}',
                '@media (prefers-color-scheme:dark){#qaap-mobile-workhub-connecting:not(.qaap-boot-theme-light){',
                '--qaap-boot-bg:#000;--qaap-boot-ink:#fff;--qaap-boot-muted:rgba(255,255,255,.7);--qaap-boot-card:#000;',
                '--qaap-boot-border:rgba(255,255,255,.08);--qaap-boot-tray:#000;--qaap-boot-sk:rgba(255,255,255,.08);',
                '--qaap-boot-sk-hi:rgba(255,255,255,.16);background:#000;color:rgba(255,255,255,.7)}}',
                '#qaap-mobile-workhub-connecting.qaap-boot-shell{justify-content:flex-start;align-items:stretch;gap:0;',
                'background:var(--qaap-boot-bg);color:var(--qaap-boot-ink);overflow:hidden;box-sizing:border-box;',
                'padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px);cursor:progress;',
                'font-family:"Inter Tight",Inter,system-ui,-apple-system,sans-serif;font-weight:400;',
                '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}',
                '.qaap-boot-shell *{box-sizing:border-box}',
                '.qaap-boot-shell-icon{width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.6;',
                'stroke-linecap:round;stroke-linejoin:round}',
                '.qaap-boot-shell-icon-sm{width:14px;height:14px}',
                '.qaap-boot-sk{display:block;flex:none;border-radius:6px;background:var(--qaap-boot-sk);',
                'background-image:linear-gradient(90deg,var(--qaap-boot-sk) 0%,var(--qaap-boot-sk-hi) 50%,var(--qaap-boot-sk) 100%);',
                'background-size:200% 100%;animation:qaap-boot-shimmer 1.4s ease-in-out infinite}',
                '@keyframes qaap-boot-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}',
                '.qaap-boot-shell-header{display:flex;align-items:center;gap:4px;height:56px;padding:0 4px 0 12px;flex:none}',
                '.qaap-boot-shell-header-btn{display:flex;align-items:center;justify-content:center;width:40px;height:40px;',
                'flex:none;color:var(--qaap-boot-ink)}',
                '.qaap-boot-shell-project{display:flex;align-items:center;gap:8px;min-width:0;flex:1;padding-left:6px;',
                'color:var(--qaap-boot-ink)}',
                '.qaap-boot-shell-project .qaap-boot-sk{width:96px;height:14px}',
                '.qaap-boot-shell-header-end{display:flex;align-items:center;gap:4px;flex:none}',
                '.qaap-boot-shell-header-end .qaap-boot-sk{width:28px;height:28px;border-radius:50%;margin:0 6px}',
                '.qaap-boot-shell-body{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;',
                'justify-content:center;gap:14px;padding:0 24px}',
                '.qaap-boot-shell-logo{width:54px;height:54px;flex:none;opacity:.82;',
                'background:var(--theia-workbench-brand-logo-url,none) center/contain no-repeat;',
                'animation:qaap-boot-breathe 2.4s ease-in-out infinite}',
                '@keyframes qaap-boot-breathe{0%,100%{opacity:.82}50%{opacity:.45}}',
                '.qaap-boot-shell-composer{flex:none;padding:4px 12px 10px;display:flex;flex-direction:column;gap:6px}',
                '.qaap-boot-shell-chips{display:flex;gap:6px;overflow:hidden;padding:4px 0 2px}',
                '.qaap-boot-shell-chip{display:flex;align-items:center;gap:6px;flex:none;height:30px;padding:5px 10px 5px 8px;',
                'border-radius:99px;border:1px solid var(--qaap-boot-border);background:var(--qaap-boot-card);',
                'color:var(--qaap-boot-muted);font-size:12px;font-weight:500;white-space:nowrap}',
                '.qaap-boot-shell-card{border-radius:16px;border:1px solid var(--qaap-boot-border);overflow:hidden;',
                'background:var(--qaap-boot-tray)}',
                '.qaap-boot-shell-input{background:var(--qaap-boot-card);border-radius:16px;padding:12px 12px 8px;',
                'border-bottom:1px solid var(--qaap-boot-border)}',
                '.qaap-boot-shell-placeholder{font-size:15px;line-height:26px;color:var(--qaap-boot-muted)}',
                '.qaap-boot-shell-controls{display:flex;align-items:center;justify-content:space-between;margin-top:10px;',
                'color:var(--qaap-boot-ink)}',
                '.qaap-boot-shell-controls-left{display:flex;align-items:center;gap:14px}',
                '.qaap-boot-shell-send{display:flex;align-items:center;justify-content:center;width:32px;height:32px;',
                'border-radius:50%;background:var(--qaap-boot-sk);color:var(--qaap-boot-muted)}',
                '.qaap-boot-shell-tray{display:flex;align-items:center;justify-content:space-between;height:40px;padding:0 14px}',
                '.qaap-boot-shell-tray .qaap-boot-sk{width:58px;height:12px}',
                '.qaap-boot-shell-tray .qaap-boot-sk+.qaap-boot-sk{width:84px}',
                '#qaap-mobile-workhub-connecting.qaap-boot-shell .qaap-mobile-workhub-connecting-label{',
                'text-align:center;font-size:13px;color:var(--qaap-boot-muted);min-height:1.4em}',
                '@media (prefers-reduced-motion:reduce){.qaap-boot-shell .qaap-boot-sk,.qaap-boot-shell-logo{animation:none}}',
                // Exact replica: a plain fixed layer; the recorded Work Hub styles itself.
                '#qaap-mobile-workhub-connecting.qaap-boot-replica{display:block;gap:0;font:inherit;color:inherit;',
                'overflow:hidden;cursor:progress;-webkit-user-select:none;user-select:none}',
                '#qaap-mobile-workhub-connecting.qaap-boot-replica *{pointer-events:none}',
                // The boot guard hides #theia-app-shell (!important); the replica's copy must show,
                // except while its stylesheets are still loading.
                '#qaap-mobile-workhub-connecting.qaap-boot-replica #theia-app-shell{visibility:visible!important}',
                '#qaap-mobile-workhub-connecting.qaap-boot-replica.qaap-boot-replica-pending #theia-app-shell{visibility:hidden!important}',
                // While the replica hands over, the real Work Hub paints its final state at once:
                // no mount fade-ins or transitions that the replica (a still picture) does not show.
                'html.qaap-boot-handover body *,html.qaap-boot-handover body *::before,html.qaap-boot-handover body *::after{',
                'animation-duration:0s!important;animation-delay:0s!important;transition:none!important}'
            ].join('');
            (document.head || document.documentElement).appendChild(shellStyle);
        }
    }

    function applyBootTheme(root, preferred) {
        var theme = resolveBootTheme(preferred);
        if (theme) {
            root.classList.add('qaap-boot-theme-' + theme);
        }
    }

    function createBootPlaceholderLabel() {
        var label = document.createElement('div');
        label.className = BOOT_PLACEHOLDER_LABEL_CLASS;
        label.setAttribute('role', 'status');
        label.setAttribute('aria-live', 'polite');
        return label;
    }

    function removeBootPlaceholder() {
        var placeholder = document.getElementById(BOOT_PLACEHOLDER_ID);
        if (placeholder) {
            placeholder.remove();
        }
    }

    /**
     * Mobile Work Hub boot guard — runs before bundle.js so the IDE shell never flashes
     * behind the Agents chat while layout + workspace restore finish loading.
     * Mirrors installMobileWorkHubBootGuard() in @theia/qaap-shared-core.
     */
    (function installMobileWorkHubBootGuardEarly() {
        try {
            if (!window.sessionStorage) {
                return;
            }
            var ss = window.sessionStorage;
            var preferDesktopIde = ss.getItem('qaap.mobileProjects.preferDesktopIde') === '1'
                || ss.getItem('qaap.mobileProjects.explicitDesktopIde') === '1';
            // A mobile one-column viewport always boots into Work Hub. Keep this query aligned
            // with MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY in core and the CSS mobile breakpoints.
            var isMobileMode = typeof window.matchMedia === 'function'
                && window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
            if (preferDesktopIde && isMobileMode) {
                ss.removeItem('qaap.mobileProjects.preferDesktopIde');
                ss.removeItem('qaap.mobileProjects.explicitDesktopIde');
                preferDesktopIde = false;
            }
            if (preferDesktopIde) {
                bootsIntoIde = true;
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
            workHubBootGuardInstalled = true;
            mobileBootMode = !!isMobileMode;
            // Safety net: never leave the shell hidden if the hub fails to mount for any reason.
            // Only lift the html boot guard — body classes are owned by @theia/qaap-work-hub and
            // must stay active while Work Hub is the surface (stripping them leaks Explorer).
            window.setTimeout(function () {
                if (!document.documentElement.classList.contains('theia-mobile-workhub-boot')) {
                    // Work Hub already mounted and lifted the guard: nothing to cover.
                    return;
                }
                if (isMobileMode) {
                    // Mobile never reveals the IDE shell: keep the guard and make sure the
                    // phase-aware placeholder is up (normally it already is since ~1.5 s, see
                    // armBootPlaceholder); clearMobileWorkHubBootGuard removes it.
                    bootPlaceholderDue = true;
                    showBootPlaceholder();
                    return;
                }
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
    var AUTH_CONFIG_TIMEOUT_MS = 4000;
    var AUTH_SESSION_TIMEOUT_MS = 6000;

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
        // The cached Work Hub shell belongs to the session that just ended.
        forgetWorkHubShellSnapshot();
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

    // Mobile-only entry (bundle-mobile.js / bundle-mobile.css: the Work Hub without any IDE code).
    // Loaded only when ALL hold: mobile Work Hub mode, a signed-in user, the server flag
    // QAAP_MOBILE_ENTRY (reported as `mobileEntry: true` by the auth session/config probe this gate
    // already awaits) and no earlier failure of the mobile entry in this tab. A script error or the
    // startup watchdog records MOBILE_ENTRY_FAILED_KEY and reloads into bundle.js; a slow download
    // (bundle watchdog) does not, since bundle.js is larger and would only be slower.
    var MOBILE_ENTRY_FAILED_KEY = 'qaap.boot.mobileEntryFailed';
    // Last server answer for QAAP_MOBILE_ENTRY, remembered so the next boot can preload the right
    // entry while /auth/session is still in flight. Only a hint: the real load still waits for the
    // fresh probe, and a wrong guess only wastes the entry file download.
    var MOBILE_ENTRY_HINT_KEY = 'qaap.boot.mobileEntryHint';
    var serverMobileEntry = false;
    var mobileEntryActive = false;

    function noteServerMobileEntry(data) {
        if (!data) {
            return;
        }
        if (data.mobileEntry === true) {
            serverMobileEntry = true;
            try {
                window.localStorage.setItem(MOBILE_ENTRY_HINT_KEY, '1');
            } catch (e) { /* ignore */ }
        } else if (data.signedIn === true) {
            // A signed-in session probe always carries the flag while it is on.
            try {
                window.localStorage.removeItem(MOBILE_ENTRY_HINT_KEY);
            } catch (e) { /* ignore */ }
        }
    }

    function rememberedServerMobileEntry() {
        try {
            return window.localStorage.getItem(MOBILE_ENTRY_HINT_KEY) === '1';
        } catch (e) {
            return false;
        }
    }

    function mobileEntryFailedBefore() {
        try {
            return !!window.sessionStorage.getItem(MOBILE_ENTRY_FAILED_KEY);
        } catch (e) {
            // Without sessionStorage a failure could not be remembered: never risk a reload loop.
            return true;
        }
    }

    function shouldLoadMobileEntry() {
        return serverMobileEntry && !bootsIntoIde && isMobileWorkHubMode() && isSignedIn() && !mobileEntryFailedBefore();
    }

    /** True when the mobile entry was in use and the page is reloading into bundle.js. */
    function fallBackFromMobileEntry(reason) {
        if (!mobileEntryActive) {
            return false;
        }
        mobileEntryActive = false;
        try {
            window.sessionStorage.setItem(MOBILE_ENTRY_FAILED_KEY, reason);
        } catch (e) { /* mobileEntryFailedBefore() treats missing storage as failed */ }
        console.warn('[Qaap] bundle-mobile.js failed (' + reason + '); reloading into bundle.js');
        window.location.reload();
        return true;
    }

    // Watchdog: if bundle.js never loads (network error, stale SW chunk mismatch)
    // show an error + retry UI so the user is never stuck on a blank spinner.
    // A slow download is not a broken mobile entry: never fall back to the larger bundle.js here.
    var bundleLoadWatchdog = window.setTimeout(function () {
        if (!window.__qaapBundleLoaded) {
            console.warn('[Qaap] bundle.js slow or failed — check network / console');
            showStartupError('bundle');
        }
    }, 30000);

    // Startup watchdog: bundle loaded but Theia DI/startup never completed.
    // Arms after bundle.js executes; fires if the splash is still visible 30s later.
    // The static frontend is served by the control plane while a cold tenant backend
    // starts, so the splash may legitimately wait for backend RPC: while the runtime
    // reports it is starting, say so and keep waiting, up to STARTUP_WAIT_CAP_MS in total.
    var STARTUP_WATCHDOG_MS = 30000;
    var STARTUP_WAIT_CAP_MS = 120000;
    var RUNTIME_STATUS_TIMEOUT_MS = 5000;
    var startupWatchdog = null;
    var startupWatchdogRounds = 0;
    var startupReady = false;

    // The product shell can become usable before the legacy Theia preload node
    // finishes its own transition. Let the app explicitly dismiss this watchdog
    // so a slow paint cannot cover a ready Work Hub with a retry dialog.
    function markStartupReady() {
        startupReady = true;
        reportBootTimings();
        if (bootRuntimePollTimer) {
            window.clearTimeout(bootRuntimePollTimer);
            bootRuntimePollTimer = null;
        }
        if (startupWatchdog) {
            window.clearTimeout(startupWatchdog);
            startupWatchdog = null;
        }
        var startupError = document.getElementById('qaap-startup-error');
        if (startupError) {
            startupError.remove();
        }
        var startupWait = document.getElementById('qaap-startup-wait');
        if (startupWait) {
            startupWait.remove();
        }
    }
    window.addEventListener('qaap-startup-ready', markStartupReady);

    function isSplashVisible() {
        var preload = document.querySelector('.theia-preload');
        return !!(preload && preload.style.display !== 'none' &&
            !preload.classList.contains('theia-hidden') &&
            preload.offsetParent !== null);
    }

    function armStartupWatchdog() {
        if (startupWatchdog || startupReady) { return; }
        startupWatchdog = window.setTimeout(onStartupWatchdog, STARTUP_WATCHDOG_MS);
    }

    function onStartupWatchdog() {
        startupWatchdog = null;
        startupWatchdogRounds += 1;
        if (startupReady || !isSplashVisible()) {
            return;
        }
        if (startupWatchdogRounds * STARTUP_WATCHDOG_MS >= STARTUP_WAIT_CAP_MS) {
            showStartupTimeout();
            return;
        }
        fetchTenantRuntimeState().then(function (state) {
            if (startupReady || !isSplashVisible()) {
                return;
            }
            // 'stopped' / 'idle' are being woken by the requests this page already made.
            if (state === 'starting' || state === 'stopped' || state === 'idle') {
                showStartupWait();
                armStartupWatchdog();
                return;
            }
            showStartupTimeout();
        });
    }

    /** Control-plane runtime state of the signed-in tenant, or undefined when unknown. */
    function fetchTenantRuntimeState() {
        return fetchWithTimeout('/qaap/api/cloud/runtime/status', { credentials: 'include' }, RUNTIME_STATUS_TIMEOUT_MS)
            .then(function (response) {
                return response && response.ok ? response.json() : null;
            })
            .then(function (data) {
                return data && data.runtime && typeof data.runtime.state === 'string' ? data.runtime.state : undefined;
            })
            .catch(function () {
                return undefined;
            });
    }

    // ---------------------------------------------------------------------------------------
    // Phase-aware mobile placeholder. Nothing extra for the first BOOT_PLACEHOLDER_DELAY_MS
    // (the cached Work Hub shell, when there is one, is already on screen); then the skeleton
    // Work Hub shell, captioned "Starting your workspace…" only while the control plane reports a
    // cold tenant runtime (otherwise the shimmering skeletons alone say it is loading).
    // ---------------------------------------------------------------------------------------
    var BOOT_PLACEHOLDER_DELAY_MS = 1500;
    var BOOT_TEXT_STARTING = 'Starting your workspace…';
    // The status read is an in-memory control-plane lookup (not user activity, never proxied to
    // the tenant). Poll it a bounded number of times while the runtime is cold; the startup
    // watchdog takes over afterwards.
    var BOOT_RUNTIME_POLL_MS = 4000;
    var BOOT_RUNTIME_POLL_MAX = 8;
    var bootPlaceholderTimer = null;
    var bootPlaceholderDue = false;
    var bootRuntimePollStarted = false;
    var bootRuntimePolls = 0;
    var bootRuntimePollTimer = null;

    function isBootGuardActive() {
        return document.documentElement.classList.contains('theia-mobile-workhub-boot');
    }

    function bootPlaceholderApplies() {
        return workHubBootGuardInstalled && mobileBootMode && !bootsIntoIde;
    }

    /** Arm the delayed placeholder; the delay counts from gate start, not from this call. */
    function armBootPlaceholder() {
        if (bootPlaceholderDue || bootPlaceholderTimer || !bootPlaceholderApplies()) {
            return;
        }
        var elapsed = bootNow() - (bootMarks['gate-start'] || 0);
        bootPlaceholderTimer = window.setTimeout(function () {
            bootPlaceholderTimer = null;
            bootPlaceholderDue = true;
            showBootPlaceholder();
        }, Math.max(0, BOOT_PLACEHOLDER_DELAY_MS - elapsed));
    }

    function showBootPlaceholder() {
        if (!bootPlaceholderApplies() || !isBootGuardActive() || document.getElementById('qaap-login-host')) {
            return;
        }
        // Same skeleton shell as the snapshot path (idempotent when that one is already up).
        paintWorkHubShell(readWorkHubShellSnapshot());
        updateBootPlaceholderLabel();
        bootMark('placeholder-shown');
    }

    function updateBootPlaceholderLabel() {
        if (!bootPlaceholderDue) {
            return;
        }
        var label = document.querySelector('#' + BOOT_PLACEHOLDER_ID + ' .' + BOOT_PLACEHOLDER_LABEL_CLASS);
        if (label) {
            label.textContent = bootRuntimeCold ? BOOT_TEXT_STARTING : '';
        }
    }

    function isColdRuntimeState(state) {
        // 'stopped' / 'idle' / 'destroyed' are being woken by the requests this page already made.
        return state === 'starting' || state === 'stopped' || state === 'idle' || state === 'destroyed';
    }

    /** Start polling the tenant runtime state once the session is known (mobile Work Hub only). */
    function startBootRuntimePolling() {
        if (bootRuntimePollStarted || !bootPlaceholderApplies() || typeof fetch !== 'function') {
            return;
        }
        bootRuntimePollStarted = true;
        pollBootRuntimeState();
    }

    function pollBootRuntimeState() {
        bootRuntimePollTimer = null;
        if (startupReady || !isBootGuardActive()) {
            return;
        }
        bootRuntimePolls += 1;
        fetchTenantRuntimeState().then(function (state) {
            if (startupReady) {
                return;
            }
            if (state === undefined) {
                // Unknown (old server, network error): keep the current text and stop asking.
                return;
            }
            var cold = isColdRuntimeState(state);
            if (cold) {
                bootMark('runtime-cold');
            }
            bootRuntimeCold = cold;
            updateBootPlaceholderLabel();
            if (cold && bootRuntimePolls < BOOT_RUNTIME_POLL_MAX && isBootGuardActive()) {
                bootRuntimePollTimer = window.setTimeout(pollBootRuntimeState, BOOT_RUNTIME_POLL_MS);
            }
        });
    }

    // ---------------------------------------------------------------------------------------
    // Instant Work Hub shell. The Work Hub writes a small read-only snapshot of what its landing
    // list last showed; on the next boot of a signed-in phone the gate paints it in the first
    // frame (inside the placeholder element, so clearMobileWorkHubBootGuard removes it).
    // Contract (written by @theia/qaap-work-hub, read only here):
    //   localStorage['qaap.workhub.shellSnapshot.v1'] = JSON {
    //     v: 1, savedAt: <epoch ms>, login: <signed-in login>, theme?: 'light' | 'dark',
    //     projects: [{ name: string, subtitle?: string, threads?: string[] }]
    //   }
    // ---------------------------------------------------------------------------------------
    var SHELL_SNAPSHOT_KEY = 'qaap.workhub.shellSnapshot.v1';
    var SHELL_SNAPSHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
    var SHELL_SNAPSHOT_MAX_PROJECTS = 12;
    var SHELL_SNAPSHOT_MAX_THREADS = 3;

    function clipText(value, max) {
        var text = String(value).replace(/\s+/g, ' ').trim();
        return text.length > max ? text.slice(0, max - 1) + '…' : text;
    }

    /** Login of the stored signed-in user (`qaap.auth.user`), or undefined. */
    function storedUserLogin() {
        try {
            var raw = localStorage.getItem(storagePrefix() + USER_SUFFIX);
            if (raw === null) {
                var i, key;
                for (i = 0; i < localStorage.length; i++) {
                    key = localStorage.key(i);
                    if (key && key.indexOf(USER_SUFFIX) !== -1) {
                        raw = localStorage.getItem(key);
                        break;
                    }
                }
            }
            var user = raw ? JSON.parse(raw) : undefined;
            return user && typeof user.login === 'string' && user.login.trim() ? user.login.trim() : undefined;
        } catch (e) {
            return undefined;
        }
    }

    /** The validated snapshot for the stored user, or undefined (missing, malformed, stale, other user). */
    function readWorkHubShellSnapshot() {
        try {
            var raw = window.localStorage.getItem(SHELL_SNAPSHOT_KEY);
            if (!raw) {
                return undefined;
            }
            var snapshot = JSON.parse(raw);
            if (!snapshot || typeof snapshot !== 'object' || snapshot.v !== 1 || !Array.isArray(snapshot.projects)) {
                return undefined;
            }
            var now = Date.now();
            if (typeof snapshot.savedAt !== 'number' || !isFinite(snapshot.savedAt)
                || now - snapshot.savedAt > SHELL_SNAPSHOT_MAX_AGE_MS || snapshot.savedAt - now > 5 * 60 * 1000) {
                return undefined;
            }
            var login = storedUserLogin();
            if (!login || typeof snapshot.login !== 'string' || snapshot.login.toLowerCase() !== login.toLowerCase()) {
                return undefined;
            }
            var projects = [];
            for (var i = 0; i < snapshot.projects.length && projects.length < SHELL_SNAPSHOT_MAX_PROJECTS; i++) {
                var project = snapshot.projects[i];
                if (!project || typeof project.name !== 'string' || !project.name.trim()) {
                    continue;
                }
                var threads = [];
                if (Array.isArray(project.threads)) {
                    for (var t = 0; t < project.threads.length && threads.length < SHELL_SNAPSHOT_MAX_THREADS; t++) {
                        if (typeof project.threads[t] === 'string' && project.threads[t].trim()) {
                            threads.push(clipText(project.threads[t], 80));
                        }
                    }
                }
                projects.push({
                    name: clipText(project.name, 80),
                    subtitle: typeof project.subtitle === 'string' ? clipText(project.subtitle, 120) : '',
                    threads: threads
                });
            }
            return { theme: snapshot.theme, projects: projects };
        } catch (e) {
            return undefined;
        }
    }

    function forgetWorkHubShellSnapshot() {
        try {
            window.localStorage.removeItem(SHELL_SNAPSHOT_KEY);
            window.localStorage.removeItem(BOOT_REPLICA_KEY);
        } catch (e) { /* ignore */ }
    }

    // ---------------------------------------------------------------------------------------
    // Exact Work Hub replica. The Work Hub records its own DOM, theme variables and stylesheets
    // (contract and writer: qaap-work-hub-boot-replica.ts in @theia/qaap-adapters); the gate
    // rebuilds that DOM with createElement under the same stylesheets, so the real Work Hub
    // mounts over a pixel-identical screen. Shown only once its stylesheets have loaded (until
    // then: the Work Hub background); any failure falls back to the drawn skeleton above.
    // ---------------------------------------------------------------------------------------
    var BOOT_REPLICA_KEY = 'qaap.workhub.bootReplica.v1';
    var BOOT_REPLICA_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
    var BOOT_REPLICA_CSS_TIMEOUT_MS = 1500;
    var BOOT_REPLICA_FONT_TIMEOUT_MS = 800;
    var BOOT_REPLICA_MAX_NODES = 6000;
    var BOOT_REPLICA_MAX_DEPTH = 80;
    var BOOT_REPLICA_SKIPPED_TAGS = /^(script|style|link|meta|iframe|object|embed|template|video|audio|canvas|noscript|base|form)$/i;
    var BOOT_REPLICA_ATTRIBUTES = /^(class|role|title|placeholder|rows|type|hidden|disabled|tabindex|dir|lang|style|viewbox|d|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-dasharray|stroke-dashoffset|stroke-miterlimit|fill-rule|clip-rule|opacity|fill-opacity|stroke-opacity|width|height|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|points|transform|preserveaspectratio|focusable|xmlns|aria-[a-z-]+|data-[a-z0-9-]+)$/i;
    var BOOT_REPLICA_STYLESHEET = /^\.\/(bundle(-mobile)?|chunk-[A-Z0-9]+)\.css(\?[A-Za-z0-9=&._-]*)?$/;
    var BOOT_REPLICA_BODY_CLASS = /^(qaap-theme-(light|dark)|theia-mobile-mod-workhub-[a-z-]+|linux|windows|mac)$/;
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var bootReplicaShellObserver = null;

    function isSafeReplicaStyle(value) {
        return !/url\s*\(|expression\s*\(|@import|javascript:/i.test(value);
    }

    /** The page's bundle stylesheet reference (mirrors QaapWorkHubBootReplicaContribution.currentBuild). */
    function currentBundleBuild() {
        var meta = document.querySelector('meta[name="qaap-bundle-css"]');
        var link = document.querySelector('link[href*="bundle.css"]');
        return (meta && meta.getAttribute('content')) || (link && link.getAttribute('href')) || '';
    }

    /** The validated replica for the stored user and this build, or undefined. */
    function readWorkHubBootReplica() {
        try {
            var raw = window.localStorage.getItem(BOOT_REPLICA_KEY);
            if (!raw) {
                return undefined;
            }
            var replica = JSON.parse(raw);
            if (!replica || replica.v !== 1 || !Array.isArray(replica.tree) || !Array.isArray(replica.stylesheets)
                || !replica.stylesheets.length || typeof replica.build !== 'string') {
                return undefined;
            }
            var now = Date.now();
            if (typeof replica.savedAt !== 'number' || !isFinite(replica.savedAt)
                || now - replica.savedAt > BOOT_REPLICA_MAX_AGE_MS || replica.savedAt - now > 5 * 60 * 1000) {
                return undefined;
            }
            var login = storedUserLogin();
            if (!login || typeof replica.login !== 'string' || replica.login.toLowerCase() !== login.toLowerCase()) {
                return undefined;
            }
            // Content-hashed chunks of another build may be gone: only repaint what this build serves.
            if (replica.build !== currentBundleBuild()) {
                return undefined;
            }
            for (var i = 0; i < replica.stylesheets.length; i++) {
                if (typeof replica.stylesheets[i] !== 'string' || !BOOT_REPLICA_STYLESHEET.test(replica.stylesheets[i])) {
                    return undefined;
                }
            }
            return replica;
        } catch (e) {
            return undefined;
        }
    }

    /** Rebuilds a recorded node; every name and attribute is re-validated. Throws on a bad tree. */
    function buildReplicaNode(node, inSvg, budget, depth) {
        if (typeof node === 'string') {
            return document.createTextNode(node);
        }
        if (!Array.isArray(node) || typeof node[0] !== 'string' || depth > BOOT_REPLICA_MAX_DEPTH || --budget.nodes < 0) {
            throw new Error('invalid replica node');
        }
        var tag = node[0];
        if (!/^[a-z][a-z0-9-]*$/i.test(tag) || BOOT_REPLICA_SKIPPED_TAGS.test(tag)) {
            return document.createTextNode('');
        }
        var svg = inSvg || tag.toLowerCase() === 'svg';
        var element = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
        var attributes = node[1];
        if (attributes && typeof attributes === 'object') {
            for (var name in attributes) {
                if (Object.prototype.hasOwnProperty.call(attributes, name)) {
                    var value = attributes[name];
                    if (typeof value === 'string' && BOOT_REPLICA_ATTRIBUTES.test(name) && !/^on/i.test(name)
                        && (name.toLowerCase() !== 'style' || isSafeReplicaStyle(value))) {
                        element.setAttribute(name, value);
                    }
                }
            }
        }
        for (var i = 2; i < node.length; i++) {
            element.appendChild(buildReplicaNode(node[i], svg, budget, depth + 1));
        }
        return element;
    }

    /** Resolves once every stylesheet has loaded (true) or one failed / the timeout passed (false). */
    function loadReplicaStylesheets(hrefs, done) {
        var pending = hrefs.length;
        var settled = false;
        var timer = window.setTimeout(function () { finish(false); }, BOOT_REPLICA_CSS_TIMEOUT_MS);
        function finish(ok) {
            if (settled) {
                return;
            }
            settled = true;
            window.clearTimeout(timer);
            done(ok);
        }
        hrefs.forEach(function (href) {
            var existing = null;
            var links = document.querySelectorAll('link[rel="stylesheet"]');
            for (var i = 0; i < links.length; i++) {
                if (links[i].getAttribute('href') === href) {
                    existing = links[i];
                }
            }
            if (existing && existing.sheet) {
                if (--pending === 0) {
                    finish(true);
                }
                return;
            }
            var link = existing || document.createElement('link');
            link.addEventListener('load', function () {
                if (--pending === 0) {
                    finish(true);
                }
            });
            link.addEventListener('error', function () { finish(false); });
            if (!existing) {
                link.rel = 'stylesheet';
                link.href = href;
                link.setAttribute('data-qaap-boot-replica', '');
                document.head.appendChild(link);
            }
        });
    }

    var BOOT_REPLICA_HANDOVER_CLASS = 'qaap-boot-handover';
    var BOOT_REPLICA_HANDOVER_TAIL_MS = 600;

    /** Let animations run again shortly after the real Work Hub replaced the replica. */
    function endReplicaHandover() {
        window.setTimeout(function () {
            document.documentElement.classList.remove(BOOT_REPLICA_HANDOVER_CLASS);
        }, BOOT_REPLICA_HANDOVER_TAIL_MS);
    }

    /** Keeps `getElementById('theia-app-shell')` on the real shell: the replica moves behind it. */
    function keepReplicaBehindRealShell(root) {
        if (typeof MutationObserver !== 'function') {
            return;
        }
        bootReplicaShellObserver = new MutationObserver(function () {
            if (!root.isConnected) {
                bootReplicaShellObserver.disconnect();
                bootReplicaShellObserver = null;
                endReplicaHandover();
                return;
            }
            var shells = document.querySelectorAll('[id="theia-app-shell"]');
            for (var i = 0; i < shells.length; i++) {
                if (!root.contains(shells[i]) && (root.compareDocumentPosition(shells[i]) & Node.DOCUMENT_POSITION_PRECEDING) === 0) {
                    document.body.appendChild(root);
                    return;
                }
            }
        });
        bootReplicaShellObserver.observe(document.body, { childList: true });
    }

    /**
     * Paint the exact Work Hub replica (first frame: the Work Hub background; then the replica
     * once its stylesheets apply). Returns false when there is nothing valid to paint.
     */
    function paintWorkHubBootReplica() {
        try {
            if (!bootPlaceholderApplies() || !isBootGuardActive() || !document.body
                || document.getElementById(BOOT_PLACEHOLDER_ID)) {
                return false;
            }
            var replica = readWorkHubBootReplica();
            if (!replica) {
                return false;
            }
            var shell = document.createElement('div');
            shell.id = 'theia-app-shell';
            if (Array.isArray(replica.shellClasses)) {
                replica.shellClasses.forEach(function (cssClass) {
                    if (typeof cssClass === 'string' && /^[A-Za-z0-9_-]+$/.test(cssClass)) {
                        shell.classList.add(cssClass);
                    }
                });
            }
            shell.appendChild(buildReplicaNode(replica.tree, false, { nodes: BOOT_REPLICA_MAX_NODES }, 0));

            injectBootPlaceholderStyles();
            var root = document.createElement('div');
            root.id = BOOT_PLACEHOLDER_ID;
            root.className = 'qaap-boot-replica qaap-boot-replica-pending';
            root.setAttribute('aria-busy', 'true');
            root.setAttribute('aria-hidden', 'true');
            root.setAttribute('inert', '');
            if (typeof replica.background === 'string' && isSafeReplicaStyle(replica.background)) {
                root.style.backgroundColor = replica.background;
            }
            root.appendChild(shell);

            // Theme variables and the theme / Work Hub chrome / OS body classes the stylesheets key
            // on (the app re-asserts all of them at startup).
            if (typeof replica.rootStyle === 'string') {
                replica.rootStyle.split(';').forEach(function (declaration) {
                    var colon = declaration.indexOf(':');
                    var name = declaration.slice(0, colon).trim();
                    var value = declaration.slice(colon + 1).trim();
                    if (colon > 2 && name.indexOf('--') === 0 && isSafeReplicaStyle(value)) {
                        document.documentElement.style.setProperty(name, value);
                    }
                });
            }
            if (Array.isArray(replica.bodyClasses)) {
                replica.bodyClasses.forEach(function (cssClass) {
                    if (typeof cssClass === 'string' && BOOT_REPLICA_BODY_CLASS.test(cssClass)) {
                        document.body.classList.add(cssClass);
                    }
                });
            }
            document.documentElement.classList.add(BOOT_REPLICA_HANDOVER_CLASS);
            document.body.appendChild(root);
            keepReplicaBehindRealShell(root);
            bootShellSnapshotPainted = true;
            bootMark('shell-painted');

            loadReplicaStylesheets(replica.stylesheets, function (ok) {
                if (!root.isConnected) {
                    return;
                }
                if (!ok) {
                    // Stylesheets missing or slow: the drawn skeleton instead of an unstyled replica.
                    document.documentElement.classList.remove(BOOT_REPLICA_HANDOVER_CLASS);
                    root.remove();
                    paintWorkHubShell(readWorkHubShellSnapshot());
                    updateBootPlaceholderLabel();
                    return;
                }
                revealReplicaWhenFontReady(root);
            });
            return true;
        } catch (e) {
            document.documentElement.classList.remove(BOOT_REPLICA_HANDOVER_CLASS);
            var broken = document.getElementById(BOOT_PLACEHOLDER_ID);
            if (broken && broken.classList.contains('qaap-boot-replica')) {
                broken.remove();
            }
            return false;
        }
    }

    /**
     * Reveal once the font faces the replica uses have loaded (bounded), so text never swaps
     * faces on screen: every @font-face of the families in the replica's font stacks is loaded
     * explicitly (hidden text does not request its faces by itself).
     */
    function revealReplicaWhenFontReady(root) {
        var revealed = false;
        function reveal() {
            if (!revealed) {
                revealed = true;
                root.classList.remove('qaap-boot-replica-pending');
                bootMark('replica-painted');
            }
        }
        window.setTimeout(reveal, BOOT_REPLICA_FONT_TIMEOUT_MS);
        try {
            var families = {};
            var styled = root.querySelectorAll('*');
            for (var i = 0; i < styled.length && i < 400; i++) {
                window.getComputedStyle(styled[i]).fontFamily.split(',').forEach(function (family) {
                    families[family.trim().replace(/^["']|["']$/g, '').toLowerCase()] = true;
                });
            }
            var loads = [];
            if (document.fonts && typeof document.fonts.forEach === 'function') {
                document.fonts.forEach(function (face) {
                    var family = String(face.family).replace(/^["']|["']$/g, '').toLowerCase();
                    if (families[family]) {
                        loads.push(face.load().catch(function () { /* a missing face falls back */ }));
                    }
                });
            }
            Promise.all(loads).then(reveal, reveal);
        } catch (e) {
            reveal();
        }
    }

    /** Paint the Work Hub shell in the first frame when a valid snapshot proves a recent session. */
    function paintWorkHubShellSnapshot() {
        var snapshot = readWorkHubShellSnapshot();
        if (!snapshot || !paintWorkHubShell(snapshot)) {
            return false;
        }
        bootShellSnapshotPainted = true;
        bootMark('shell-painted');
        return true;
    }

    // Stroke paths (24×24 viewBox) for the few icons the shell draws.
    var BOOT_SHELL_ICONS = {
        sidebar: ['M4 5h16v14H4z', 'M9 5v14'],
        folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
        chevron: ['m6 9 6 6 6-6'],
        more: ['M12 5h.01', 'M12 12h.01', 'M12 19h.01'],
        plus: ['M12 5v14', 'M5 12h14'],
        send: ['m22 2-7 20-4-9-9-4z', 'M22 2 11 13'],
        bug: ['M8 9h8v7a4 4 0 0 1-8 0z', 'M12 9V6', 'M4 13h4', 'M16 13h4'],
        review: ['M6 3v12', 'M18 9v12', 'M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6', 'M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6'],
        beaker: ['M9 3h6', 'M10 3v6L5 19a1 1 0 0 0 1 2h12a1 1 0 0 0 1-2l-5-10V3'],
        search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14', 'm20 20-4-4']
    };
    var BOOT_SHELL_QUICK_ACTIONS = [
        ['bug', 'Fix a bug'], ['review', 'Review PR'], ['beaker', 'Add tests'], ['search', 'Explore code']
    ];

    function bootShellIcon(name, small) {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('class', 'qaap-boot-shell-icon' + (small ? ' qaap-boot-shell-icon-sm' : ''));
        BOOT_SHELL_ICONS[name].forEach(function (d) {
            var path = document.createElementNS(ns, 'path');
            path.setAttribute('d', d);
            svg.appendChild(path);
        });
        return svg;
    }

    function bootShellElement(tag, className, children) {
        var element = document.createElement(tag);
        element.className = className;
        (children || []).forEach(function (child) {
            element.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
        return element;
    }

    function bootShellSkeleton() {
        return bootShellElement('span', 'qaap-boot-sk');
    }

    /**
     * Paint a read-only replica of the mobile Work Hub home: the static chrome (header, quick
     * actions, composer) as the real Work Hub draws it, and skeleton bars wherever the content
     * depends on data that is still loading (project, agent mode / model). Text goes through
     * text nodes only. Non-interactive: the overlay swallows taps until the real Work Hub
     * replaces it (clearMobileWorkHubBootGuard removes it by id).
     */
    function paintWorkHubShell(snapshot) {
        try {
            if (!bootPlaceholderApplies() || !isBootGuardActive() || !document.body
                || document.getElementById(BOOT_PLACEHOLDER_ID)) {
                return false;
            }
            injectBootPlaceholderStyles();
            var root = document.createElement('div');
            root.id = BOOT_PLACEHOLDER_ID;
            root.className = 'qaap-boot-shell';
            root.setAttribute('aria-busy', 'true');
            root.setAttribute('aria-label', appName());
            applyBootTheme(root, snapshot && snapshot.theme);

            var header = bootShellElement('header', 'qaap-boot-shell-header', [
                bootShellElement('span', 'qaap-boot-shell-header-btn', [bootShellIcon('sidebar')]),
                bootShellElement('span', 'qaap-boot-shell-project', [
                    bootShellIcon('folder', true), bootShellSkeleton(), bootShellIcon('chevron', true)
                ]),
                bootShellElement('span', 'qaap-boot-shell-header-end', [
                    bootShellSkeleton(),
                    bootShellElement('span', 'qaap-boot-shell-header-btn', [bootShellIcon('more')])
                ])
            ]);
            var logo = bootShellElement('div', 'qaap-boot-shell-logo');
            logo.setAttribute('aria-hidden', 'true');
            var body = bootShellElement('main', 'qaap-boot-shell-body', [logo, createBootPlaceholderLabel()]);

            var chips = bootShellElement('div', 'qaap-boot-shell-chips', BOOT_SHELL_QUICK_ACTIONS.map(function (action) {
                return bootShellElement('span', 'qaap-boot-shell-chip', [bootShellIcon(action[0], true), action[1]]);
            }));
            var composer = bootShellElement('footer', 'qaap-boot-shell-composer', [
                chips,
                bootShellElement('div', 'qaap-boot-shell-card', [
                    bootShellElement('div', 'qaap-boot-shell-input', [
                        bootShellElement('div', 'qaap-boot-shell-placeholder', ['Delegate a task…']),
                        bootShellElement('div', 'qaap-boot-shell-controls', [
                            bootShellElement('span', 'qaap-boot-shell-controls-left', [
                                bootShellIcon('plus'), bootShellIcon('chevron', true)
                            ]),
                            bootShellElement('span', 'qaap-boot-shell-send', [bootShellIcon('send', true)])
                        ])
                    ]),
                    bootShellElement('div', 'qaap-boot-shell-tray', [bootShellSkeleton(), bootShellSkeleton()])
                ])
            ]);
            root.appendChild(header);
            root.appendChild(body);
            root.appendChild(composer);
            document.body.appendChild(root);
            return true;
        } catch (e) {
            return false;
        }
    }

    function showStartupTimeout() {
        if (fallBackFromMobileEntry('startup-timeout')) {
            return;
        }
        var startupWait = document.getElementById('qaap-startup-wait');
        if (startupWait) {
            startupWait.remove();
        }
        console.warn('[Qaap] Theia startup timed out — showing retry UI');
        showStartupError('startup');
    }

    function showStartupWait() {
        var preload = document.querySelector('.theia-preload');
        if (!preload || document.getElementById('qaap-startup-wait')) { return; }
        if (!document.getElementById('qaap-startup-wait-styles')) {
            var style = document.createElement('style');
            style.id = 'qaap-startup-wait-styles';
            style.textContent =
                '#qaap-startup-wait{position:absolute;left:0;right:0;bottom:22%;text-align:center;' +
                'font:500 14px/1.4 system-ui,-apple-system,sans-serif;color:#666}' +
                '@media(prefers-color-scheme:dark){#qaap-startup-wait{color:#a0a0a0}}';
            document.head.appendChild(style);
        }
        var message = document.createElement('div');
        message.id = 'qaap-startup-wait';
        message.setAttribute('role', 'status');
        message.setAttribute('aria-live', 'polite');
        message.textContent = 'Starting your workspace\u2026';
        preload.appendChild(message);
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

    var resolvedBundleUrl;

    function resolveBundleUrl() {
        // The modulepreload hint and the module script must request the SAME
        // URL, otherwise the localhost fallback below fetches bundle.js twice.
        if (!resolvedBundleUrl) {
            resolvedBundleUrl = computeBundleUrl();
        }
        return resolvedBundleUrl;
    }

    function computeBundleUrl() {
        // copy-frontend-static versions bundle.css in development. Reuse that
        // version for JS so a reload always fetches the current entry point;
        // code-split chunks are content-hashed and are never stamped.
        var stylesheet = document.querySelector('link[href*="bundle.css"]');
        var stylesheetMeta = document.querySelector('meta[name="qaap-bundle-css"]');
        var href = stylesheet && stylesheet.getAttribute('href')
            || stylesheetMeta && stylesheetMeta.getAttribute('content');
        var match = href && href.match(/[?&]qaap-build=([^&#]+)/);
        if (match) {
            return './bundle.js?qaap-build=' + encodeURIComponent(match[1]);
        }
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '[::1]') {
            return './bundle.js?qaap-build=' + Date.now().toString(36);
        }
        return './bundle.js';
    }

    function mobileBundleUrl() {
        return resolveBundleUrl().replace('bundle.js', 'bundle-mobile.js');
    }

    function isMobileWorkHubMode() {
        return typeof window.matchMedia === 'function'
            && window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
    }

    function activateBundleStylesheet(mobileEntry) {
        if (document.querySelector('link[href*="bundle.css"]') || document.querySelector('link[href*="bundle-mobile.css"]')) {
            return;
        }
        var stylesheetMeta = document.querySelector('meta[name="qaap-bundle-css"]');
        var href = stylesheetMeta && stylesheetMeta.getAttribute('content');
        if (!href) {
            return;
        }
        if (mobileEntry) {
            href = href.replace('bundle.css', 'bundle-mobile.css');
        }
        var stylesheet = document.createElement('link');
        stylesheet.id = 'qaap-bundle-css';
        stylesheet.rel = 'stylesheet';
        stylesheet.href = href;
        document.head.appendChild(stylesheet);
    }

    function dismissLoginGate() {
        var host = document.getElementById('qaap-login-host');
        if (host) {
            host.remove();
        }
        if (document.body) {
            document.body.classList.remove('qaap-login-active');
        }
    }

    // Work Hub reads the frontend only issues once all of its modules are loaded, seconds after
    // the session is known (7-12 s into a cold load). Start them with the bundle; the frontend
    // takes the responses through @theia/qaap-adapters' qaap-boot-prefetch.ts.
    var BOOT_PREFETCH_PATHS = ['/qaap/api/github/project-sessions', '/qaap/api/user-settings'];

    function prefetchWorkHubData() {
        if (bootsIntoIde || window.__qaapBootPrefetch || typeof fetch !== 'function' || !isSignedIn()) {
            return;
        }
        var entries = {};
        BOOT_PREFETCH_PATHS.forEach(function (path) {
            var response = fetch(path, { credentials: 'include' });
            // Consumed (or dropped) by the frontend; never an unhandled rejection here.
            response.catch(function () { /* the frontend refetches */ });
            entries[path] = { startedAt: Date.now(), response: response };
        });
        window.__qaapBootPrefetch = entries;
    }

    function loadBundle() {
        if (window.__qaapBundleLoading || window.__qaapBundleLoaded) {
            return;
        }
        prefetchWorkHubData();
        mobileEntryActive = shouldLoadMobileEntry();
        bootEntry = mobileEntryActive ? 'mobile' : 'full';
        activateBundleStylesheet(mobileEntryActive);
        window.__qaapBundleLoading = true;
        var script = document.createElement('script');
        // The frontend builds as ES modules (esbuild code-splitting); the
        // browser resolves and parallel-loads the shared chunks itself.
        script.type = 'module';
        script.charset = 'utf-8';
        // Same URL (query included) as speculativePreloadBundle() so the browser reuses the preload.
        script.src = mobileEntryActive ? mobileBundleUrl() : resolveBundleUrl();
        bootMark('bundle-requested');
        armBootPlaceholder();
        script.onload = function () {
            bootMark('bundle-loaded');
            window.__qaapBundleLoaded = true;
            window.clearTimeout(bundleLoadWatchdog);
            armStartupWatchdog();
        };
        script.onerror = function () {
            window.__qaapBundleLoading = false;
            if (fallBackFromMobileEntry('script-error')) {
                return;
            }
            console.error('[Qaap] Failed to load application bundle.');
            showStartupError('bundle');
        };
        document.body.appendChild(script);
    }

    /** The user is known to be signed in: load the app and, on phones, learn whether the workspace is cold. */
    function loadBundleForVerifiedSession() {
        bootMark('session-verified');
        loadBundle();
        // After loadBundle(): its Work Hub prefetch is what wakes a stopped tenant runtime.
        startBootRuntimePolling();
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
            '.qaap-login-actions{display:flex;flex-direction:column;gap:10px;width:100%;max-width:360px;margin:0 auto}',
            '.qaap-login-btn{width:100%;min-height:44px;height:48px;border-radius:10px;cursor:pointer;font:inherit;font-size:15px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:10px;touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
            '.qaap-login-btn[hidden]{display:none}',
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
        // A cached Work Hub shell (or loading placeholder) must not linger behind the sign-in screen.
        removeBootPlaceholder();
        if (bootPlaceholderTimer) {
            window.clearTimeout(bootPlaceholderTimer);
            bootPlaceholderTimer = null;
        }
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
            '<button type="button" id="qaap-login-local" class="qaap-login-btn qaap-login-btn--secondary" hidden>Continue in local mode</button>' +
            '<button type="button" id="qaap-login-retry" class="qaap-login-btn qaap-login-btn--secondary" hidden>Retry connection</button>' +
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

        var local = document.getElementById('qaap-login-local');
        if (local) {
            local.addEventListener('click', function (e) {
                e.preventDefault();
                local.disabled = true;
                local.setAttribute('aria-busy', 'true');
                writeSignedIn('gitlab', {
                    provider: 'gitlab',
                    login: 'dev',
                    name: 'Dev User',
                });
                document.body.classList.remove('qaap-login-active');
                host.remove();
                loadBundleForVerifiedSession();
            });
        }

        var retry = document.getElementById('qaap-login-retry');
        if (retry) {
            retry.addEventListener('click', function (e) {
                e.preventDefault();
                retry.disabled = true;
                var status = host.querySelector('#qaap-login-status');
                if (status) {
                    status.textContent = 'Checking server connection…';
                }
                reflectGithubAvailability(host);
            });
        }

        host.addEventListener('keydown', function (event) {
            if (event.key !== 'Tab') {
                return;
            }
            // `hidden` buttons (local mode / retry until offered) cannot take focus: leaving them
            // in the list made the trap wrap onto an element focus() ignores, letting Tab escape.
            var focusable = Array.prototype.slice.call(host.querySelectorAll(
                'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
            )).filter(function (element) { return !element.hidden; });
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

        // If GitHub OAuth is not configured, keep the user on this page with an actionable hint.
        reflectGithubAvailability(host);
    }

    function showGateAndLoadBundle() {
        var render = function () {
            if (!document.getElementById('qaap-login-host')) {
                showGate();
            }
            // Keep the gate in front while the workbench starts on desktop. Phones only
            // need the small gate here; load Work Hub assets after authentication.
            if (!isMobileWorkHubMode()) {
                loadBundle();
            }
        };
        if (document.body) {
            render();
        } else {
            document.addEventListener('DOMContentLoaded', render, { once: true });
        }
    }

    function reflectGithubAvailability(host) {
        var button = host.querySelector('#qaap-login-github');
        var local = host.querySelector('#qaap-login-local');
        var retry = host.querySelector('#qaap-login-retry');
        var status = host.querySelector('#qaap-login-status');
        var productionRuntime = false;
        if (local) {
            local.hidden = true;
        }
        if (retry) {
            retry.hidden = true;
            retry.disabled = false;
        }
        if (button) {
            button.disabled = false;
            button.removeAttribute('aria-disabled');
            button.classList.remove('qaap-login-btn--unavailable');
            var defaultLabel = button.querySelector('.qaap-login-btn-label');
            if (defaultLabel) {
                defaultLabel.textContent = 'Sign in with GitHub';
            }
        }
        fetchWithTimeout('/qaap/api/auth/config', { credentials: 'include' }, AUTH_CONFIG_TIMEOUT_MS)
            .then(function (res) { return res && res.ok ? res.json() : null; })
            .then(function (config) {
                // Keep the user on this page when OAuth configuration is unavailable.
                if (!config) {
                    throw new Error('config');
                }
                productionRuntime = config.productionRuntime === true;
                if (productionRuntime) {
                    if (local) {
                        local.hidden = true;
                    }
                    if (retry) {
                        retry.hidden = true;
                    }
                }
                if (!productionRuntime && config.skipAuth === true && local) {
                    local.hidden = false;
                    if (status) {
                        status.textContent = 'Local development mode is enabled on this server.';
                    }
                }
                if (config.githubOAuth === true) {
                    return;
                }
                setGithubUnavailable(host, !productionRuntime && config.skipAuth === true
                    ? 'GitHub sign-in is unavailable. Continue in local mode or configure GitHub OAuth.'
                    : 'GitHub sign-in isn’t configured on this server yet. Ask the administrator to set the GitHub OAuth credentials.');
            })
            .catch(function () {
                // A failed or slow config probe does not prove the server is down. Leave GitHub
                // sign-in enabled; an unavailable capabilities probe is not a liveness check.
                if (status) {
                    status.textContent = '';
                }
                if (retry) {
                    retry.hidden = true;
                    retry.disabled = false;
                }
            });
    }

    function setGithubUnavailable(host, message) {
        var button = host.querySelector('#qaap-login-github');
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
            status.textContent = message;
        }
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
        forgetWorkHubShellSnapshot();
    }

    function fetchWithTimeout(url, options, timeoutMs) {
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var requestOptions = options || {};
        if (controller) {
            requestOptions = Object.assign({}, requestOptions, { signal: controller.signal });
        }
        var timer;
        return Promise.race([
            fetch(url, requestOptions),
            new Promise(function (_resolve, reject) {
                timer = window.setTimeout(function () {
                    if (controller) {
                        controller.abort();
                    }
                    reject(new Error('timeout'));
                }, timeoutMs);
            }),
        ]).finally(function () {
            window.clearTimeout(timer);
        });
    }

    function stripOAuthQueryParams() {
        try {
            var next = new URL(window.location.href);
            if (!next.searchParams.has('qaap_oauth') && !next.searchParams.has('qaap_oauth_error')) {
                return;
            }
            next.searchParams.delete('qaap_oauth');
            next.searchParams.delete('qaap_oauth_error');
            next.searchParams.delete('qaap_oauth_reason');
            window.history.replaceState({}, '', next.pathname + next.search + (next.hash || ''));
        } catch (e) { /* ignore */ }
    }

    /** Resolves with the parsed session JSON; rejects on network/HTTP failure. */
    function fetchSessionProbe() {
        return fetchWithTimeout('/qaap/api/auth/session', { credentials: 'include' }, AUTH_SESSION_TIMEOUT_MS)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('session');
                }
                return response.json();
            });
    }

    /**
     * @param sessionProbe optional already-started session probe (see the parallel boot probes
     * at the bottom of this file) so a cold start does not pay two sequential round-trips.
     */
    function resumeAfterOAuthOrSession(sessionProbe, skipAuthProbe) {
        if (window.location.search.indexOf('qaap_oauth_error=1') !== -1) {
            try {
                var errParams = new URLSearchParams(window.location.search);
                var reason = errParams.get('qaap_oauth_reason');
                console.error('[Qaap] GitHub OAuth callback failed.', reason ? 'Reason: ' + reason : '(no reason provided by backend)');
            } catch (e) { /* ignore */ }
        }
        if (window.location.search.indexOf('qaap_oauth=github') !== -1) {
            fetchWithTimeout('/qaap/api/auth/session', { credentials: 'include' }, AUTH_SESSION_TIMEOUT_MS)
                .then(function (response) {
                    if (!response.ok) {
                        throw new Error('session');
                    }
                    return response.json();
                })
                .then(function (data) {
                    stripOAuthQueryParams();
                    noteServerMobileEntry(data);
                    if (!(data && data.signedIn && data.user && data.user.provider)) {
                        // Never reveal the IDE without a session: it would boot unauthenticated
                        // and flash 401s before the user can sign in again.
                        throw new Error('unsigned');
                    }
                    writeSignedIn(data.user.provider, data.user);
                    if (document.body) {
                        document.body.classList.remove('qaap-login-active');
                    }
                    var host = document.getElementById('qaap-login-host');
                    if (host) {
                        host.remove();
                    }
                    loadBundleForVerifiedSession();
                })
                .catch(function () {
                    stripOAuthQueryParams();
                    clearStaleAuthLocalStorage();
                    if (document.body) {
                        showGateAndLoadBundle();
                    } else {
                        document.addEventListener('DOMContentLoaded', showGateAndLoadBundle, { once: true });
                    }
                });
            return;
        }
        (sessionProbe || fetchSessionProbe())
            .then(function (data) {
                noteServerMobileEntry(data);
                if (data && data.signedIn && data.user && data.user.provider) {
                    writeSignedIn(data.user.provider, data.user);
                    dismissLoginGate();
                    loadBundleForVerifiedSession();
                    return;
                }
                throw new Error('unsigned');
            })
            .catch(function (err) {
                console.warn('[Qaap] session check failed, showing login gate', err && err.message);
                var showGate = function () {
                    if (document.body) {
                        showGateAndLoadBundle();
                    } else {
                        document.addEventListener('DOMContentLoaded', showGateAndLoadBundle, { once: true });
                    }
                };
                if (skipAuthProbe) {
                    skipAuthProbe.then(function (skipped) {
                        if (skipped !== true) {
                            showGate();
                        }
                    });
                } else {
                    showGate();
                }
            });
    }

    function trySkipAuthDevMode() {
        return fetchWithTimeout('/qaap/api/auth/config', { credentials: 'include' }, AUTH_CONFIG_TIMEOUT_MS)
            .then(function (response) {
                if (!response.ok) {
                    return undefined;
                }
                return response.json();
            })
            .then(function (config) {
                if (!config) {
                    return undefined;
                }
                noteServerMobileEntry(config);
                if (config && config.skipAuth) {
                    writeSignedIn('gitlab', {
                        provider: 'gitlab',
                        login: 'dev',
                        name: 'Dev User',
                    });
                    dismissLoginGate();
                    loadBundleForVerifiedSession();
                    return true;
                }
                return false;
            })
            .catch(function () {
                // A failed config probe is not evidence that another auth probe can help.
                // Return an explicit unknown state so startup does not wait for a second
                // timeout against the same unreachable VPS/proxy.
                return undefined;
            });
    }

    function verifyStoredSessionThenLoad() {
        fetchWithTimeout('/qaap/api/auth/session', { credentials: 'include' }, AUTH_SESSION_TIMEOUT_MS)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('session');
                }
                return response.json();
            })
            .then(function (data) {
                noteServerMobileEntry(data);
                if (data && data.signedIn && data.user && data.user.provider) {
                    writeSignedIn(data.user.provider, data.user);
                    loadBundleForVerifiedSession();
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
                            showGateAndLoadBundle();
                        } else {
                            document.addEventListener('DOMContentLoaded', showGateAndLoadBundle, { once: true });
                        }
                    }
                }).catch(function () {
                    if (document.body) {
                        showGateAndLoadBundle();
                    } else {
                        document.addEventListener('DOMContentLoaded', showGateAndLoadBundle, { once: true });
                    }
                });
            });
    }

    // Speculatively preload the entry module while the auth check is in flight.
    // On a warm session the user is signed in — the bundle starts downloading
    // immediately instead of waiting for the /auth/session round-trip.
    // Phones only do this with a stored session: the unauthenticated Work Hub gate downloads no
    // app code. They preload the entry the last session probe chose (bundle-mobile.js while
    // QAAP_MOBILE_ENTRY is on); loadBundle() requests the identical URL, so the module is reused.
    function speculativePreloadBundle() {
        var href = resolveBundleUrl();
        if (isMobileWorkHubMode()) {
            if (bootsIntoIde || !isSignedIn()) {
                return;
            }
            if (rememberedServerMobileEntry() && !mobileEntryFailedBefore()) {
                href = mobileBundleUrl();
            }
        }
        try {
            if (document.querySelector('link[data-qaap-boot-preload]')) {
                return;
            }
            var link = document.createElement('link');
            link.rel = 'modulepreload';
            link.href = href;
            link.as = 'script';
            link.crossOrigin = 'anonymous';
            link.setAttribute('data-qaap-boot-preload', '');
            (document.head || document.documentElement).appendChild(link);
            bootMark('bundle-preloaded');
        } catch (_) { /* ignore */ }
    }

    if (window.location.search.indexOf('qaap_oauth=github') !== -1
        || window.location.search.indexOf('qaap_oauth_error=1') !== -1) {
        speculativePreloadBundle();
        resumeAfterOAuthOrSession();
    } else if (isSignedIn()) {
        // Signed-in phone: paint the cached Work Hub shell in the first frame, start the app
        // download in parallel with the session check, and arm the phase-aware placeholder.
        if (!paintWorkHubBootReplica()) {
            paintWorkHubShellSnapshot();
        }
        armBootPlaceholder();
        speculativePreloadBundle();
        verifyStoredSessionThenLoad();
    } else {
        // Probe auth config and session in parallel (cold tenant containers make each
        // round-trip expensive). On phones, render the small gate before either probe resolves;
        // desktop keeps its existing auth-first transition and loads the workbench unchanged.
        var parallelSessionProbe = fetchSessionProbe();
        // Avoid an unhandled rejection when the probe result is never consumed.
        parallelSessionProbe.catch(function () { /* handled by resumeAfterOAuthOrSession */ });
        var skipAuthProbe = trySkipAuthDevMode();
        if (isMobileWorkHubMode()) {
            showGateAndLoadBundle();
            resumeAfterOAuthOrSession(parallelSessionProbe, skipAuthProbe);
        } else {
            skipAuthProbe.then(function (skipped) {
                if (skipped === false) {
                    resumeAfterOAuthOrSession(parallelSessionProbe);
                } else if (skipped === true) {
                    speculativePreloadBundle();
                } else {
                    showGateAndLoadBundle();
                }
            });
        }
        skipAuthProbe.catch(function () { /* handled by trySkipAuthDevMode */ });
    }
})();
