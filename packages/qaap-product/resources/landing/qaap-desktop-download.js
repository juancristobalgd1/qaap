/* Qaap landing: desktop installer invitation. Pure detection, shared by the page and its spec. */
(function (root) {
    'use strict';

    var MOBILE_USER_AGENT = /Android|iPhone|iPad|iPod|Mobile|CrOS/i;
    var ELECTRON_USER_AGENT = /\bElectron\//;
    var LABELS = { mac: 'macOS', windows: 'Windows', linux: 'Linux' };

    function platformFromClientHint(platform) {
        switch (typeof platform === 'string' ? platform.trim() : '') {
            case 'macOS': return 'mac';
            case 'Windows': return 'windows';
            case 'Linux': return 'linux';
            case 'Android':
            case 'Chrome OS':
            case 'iOS':
                return null; // a named non-desktop OS: refuse
            default: return undefined; // absent or unknown: fall back to the user agent
        }
    }

    /**
     * Desktop platform of the browser ('mac' | 'windows' | 'linux'), or undefined when the invitation
     * must not be shown: phones, tablets (iPadOS reports a Mac user agent with touch points), Chrome OS,
     * the Electron app, or an unknown platform.
     */
    function detectDesktopDownloadPlatform(hints) {
        var userAgent = (hints && hints.userAgent) || '';
        if (!userAgent || ELECTRON_USER_AGENT.test(userAgent) || MOBILE_USER_AGENT.test(userAgent)) {
            return undefined;
        }
        var isMacUserAgent = /Macintosh|Mac OS X/.test(userAgent);
        if (isMacUserAgent && ((hints && hints.maxTouchPoints) || 0) > 0) {
            return undefined;
        }
        var fromHint = platformFromClientHint(hints && hints.userAgentDataPlatform);
        if (fromHint === null) {
            return undefined;
        }
        if (fromHint) {
            return fromHint;
        }
        if (isMacUserAgent) { return 'mac'; }
        if (/Windows/.test(userAgent)) { return 'windows'; }
        if (/Linux|X11/.test(userAgent)) { return 'linux'; }
        return undefined;
    }

    var api = { detectDesktopDownloadPlatform: detectDesktopDownloadPlatform, LABELS: LABELS };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.QaapDesktopDownload = api;
})(typeof window !== 'undefined' ? window : globalThis);
