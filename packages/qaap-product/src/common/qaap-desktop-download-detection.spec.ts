// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

// The landing page ships this file as-is, so the spec runs the shipped detection code.
const detectionPath = path.resolve(__dirname, '../../resources/landing/qaap-desktop-download.js');
const { detectDesktopDownloadPlatform } = require(detectionPath) as {
    detectDesktopDownloadPlatform(hints: { userAgent?: string; userAgentDataPlatform?: string; maxTouchPoints?: number }): 'mac' | 'windows' | 'linux' | undefined;
};

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPADOS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const ELECTRON_UA = `${LINUX_UA} Electron/31.0.0 QaapDesktop/1.0.0`;

describe('Qaap desktop download detection', () => {

    it('detects macOS, Windows and Linux desktop browsers', () => {
        expect(detectDesktopDownloadPlatform({ userAgent: MAC_UA, maxTouchPoints: 0 })).to.equal('mac');
        expect(detectDesktopDownloadPlatform({ userAgent: WINDOWS_UA })).to.equal('windows');
        expect(detectDesktopDownloadPlatform({ userAgent: LINUX_UA })).to.equal('linux');
    });

    it('prefers userAgentData.platform when it names a desktop OS', () => {
        expect(detectDesktopDownloadPlatform({ userAgent: MAC_UA, userAgentDataPlatform: 'macOS', maxTouchPoints: 0 })).to.equal('mac');
        expect(detectDesktopDownloadPlatform({ userAgent: WINDOWS_UA, userAgentDataPlatform: 'Windows' })).to.equal('windows');
        expect(detectDesktopDownloadPlatform({ userAgent: LINUX_UA, userAgentDataPlatform: 'Linux' })).to.equal('linux');
    });

    it('returns undefined for phones and tablets', () => {
        expect(detectDesktopDownloadPlatform({ userAgent: IPHONE_UA, maxTouchPoints: 5 })).to.be.undefined;
        expect(detectDesktopDownloadPlatform({ userAgent: ANDROID_UA, maxTouchPoints: 5 })).to.be.undefined;
    });

    it('returns undefined for iPadOS, which reports a Mac user agent with touch points', () => {
        expect(detectDesktopDownloadPlatform({ userAgent: IPADOS_UA, maxTouchPoints: 5 })).to.be.undefined;
    });

    it('returns undefined inside the Electron app', () => {
        expect(detectDesktopDownloadPlatform({ userAgent: ELECTRON_UA, maxTouchPoints: 0 })).to.be.undefined;
    });

    it('returns undefined when the platform cannot be determined', () => {
        expect(detectDesktopDownloadPlatform({})).to.be.undefined;
        expect(detectDesktopDownloadPlatform({ userAgent: '' })).to.be.undefined;
        expect(detectDesktopDownloadPlatform({ userAgent: 'SomeBot/1.0' })).to.be.undefined;
    });

    it('refuses a Chrome OS or Android client hint even with a desktop-looking user agent', () => {
        expect(detectDesktopDownloadPlatform({ userAgent: LINUX_UA, userAgentDataPlatform: 'Android' })).to.be.undefined;
        expect(detectDesktopDownloadPlatform({ userAgent: LINUX_UA, userAgentDataPlatform: 'Chrome OS' })).to.be.undefined;
    });

    it('ignores an unknown client hint and falls back to the user agent', () => {
        expect(detectDesktopDownloadPlatform({ userAgent: WINDOWS_UA, userAgentDataPlatform: 'Something' })).to.equal('windows');
    });

    it('ships the detection file the landing page loads', () => {
        expect(fs.existsSync(detectionPath)).to.equal(true);
    });
});
