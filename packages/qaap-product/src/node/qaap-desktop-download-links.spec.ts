// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_DESKTOP_DOWNLOAD_ENV, resolveQaapDesktopDownloadLinks } from './qaap-desktop-download-links';

describe('resolveQaapDesktopDownloadLinks', () => {

    it('returns no links when no installer variable is set', () => {
        expect(resolveQaapDesktopDownloadLinks({})).to.deep.equal({});
    });

    it('maps each platform variable to its installer URL', () => {
        const links = resolveQaapDesktopDownloadLinks({
            QAAP_DESKTOP_DOWNLOAD_URL_MAC: 'https://downloads.example.com/Qaap.dmg',
            QAAP_DESKTOP_DOWNLOAD_URL_WIN: 'https://downloads.example.com/Qaap-setup.exe',
            QAAP_DESKTOP_DOWNLOAD_URL_LINUX: 'https://downloads.example.com/Qaap.AppImage',
        });
        expect(links).to.deep.equal({
            mac: 'https://downloads.example.com/Qaap.dmg',
            windows: 'https://downloads.example.com/Qaap-setup.exe',
            linux: 'https://downloads.example.com/Qaap.AppImage',
        });
    });

    it('uses the documented variable names', () => {
        expect(QAAP_DESKTOP_DOWNLOAD_ENV).to.deep.equal({
            mac: 'QAAP_DESKTOP_DOWNLOAD_URL_MAC',
            windows: 'QAAP_DESKTOP_DOWNLOAD_URL_WIN',
            linux: 'QAAP_DESKTOP_DOWNLOAD_URL_LINUX',
        });
    });

    it('drops non-https, credentialed, relative and malformed URLs', () => {
        const links = resolveQaapDesktopDownloadLinks({
            QAAP_DESKTOP_DOWNLOAD_URL_MAC: 'http://downloads.example.com/Qaap.dmg',
            QAAP_DESKTOP_DOWNLOAD_URL_WIN: 'https://user:secret@downloads.example.com/Qaap.exe',
            QAAP_DESKTOP_DOWNLOAD_URL_LINUX: '/Qaap.AppImage',
        });
        expect(links).to.deep.equal({});
    });

    it('trims whitespace and ignores blank values', () => {
        const links = resolveQaapDesktopDownloadLinks({
            QAAP_DESKTOP_DOWNLOAD_URL_MAC: '  https://downloads.example.com/Qaap.dmg  ',
            QAAP_DESKTOP_DOWNLOAD_URL_WIN: '   ',
        });
        expect(links).to.deep.equal({ mac: 'https://downloads.example.com/Qaap.dmg' });
    });
});
