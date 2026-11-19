// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { decideQaapDesktopUpdateMode, pickLatestDesktopReleaseTag, QaapDesktopUpdateContext } from './qaap-desktop-update-policy';

function decide(overrides: Partial<QaapDesktopUpdateContext>): string {
    return decideQaapDesktopUpdateMode({ isPackaged: true, platform: 'win32', env: {}, ...overrides }).mode;
}

describe('decideQaapDesktopUpdateMode', () => {

    it('is disabled in a development run on every platform', () => {
        for (const platform of ['darwin', 'win32', 'linux'] as const) {
            expect(decide({ isPackaged: false, platform, env: { APPIMAGE: '/tmp/Qaap.AppImage' } })).to.equal('disabled');
        }
    });

    it('installs in place on Windows', () => {
        expect(decide({ platform: 'win32' })).to.equal('auto-install');
    });

    it('only notifies on an unsigned macOS build', () => {
        expect(decide({ platform: 'darwin' })).to.equal('notify-only');
        expect(decide({ platform: 'darwin', signedBuild: false })).to.equal('notify-only');
    });

    it('installs in place on a signed macOS build', () => {
        expect(decide({ platform: 'darwin', signedBuild: true })).to.equal('auto-install');
    });

    it('installs in place for the Linux AppImage and only notifies for the deb', () => {
        expect(decide({ platform: 'linux', env: { APPIMAGE: '/home/u/Qaap-linux-x86_64.AppImage' } })).to.equal('auto-install');
        expect(decide({ platform: 'linux', env: {} })).to.equal('notify-only');
    });

    it('honours the operator switch', () => {
        for (const value of ['0', 'false', 'OFF', ' off ']) {
            expect(decide({ platform: 'win32', env: { QAAP_DESKTOP_AUTO_UPDATE: value } })).to.equal('disabled');
        }
        expect(decide({ platform: 'win32', env: { QAAP_DESKTOP_AUTO_UPDATE: '1' } })).to.equal('auto-install');
    });

    it('is disabled on a platform it does not know', () => {
        expect(decide({ platform: 'freebsd' })).to.equal('disabled');
    });
});

describe('pickLatestDesktopReleaseTag', () => {

    it('picks the highest desktop version, not the first or the newest created', () => {
        expect(pickLatestDesktopReleaseTag([
            { tag_name: 'desktop-v0.2.0' },
            { tag_name: 'desktop-v0.10.1' },
            { tag_name: 'desktop-v0.9.9' }
        ])).to.equal('desktop-v0.10.1');
    });

    it('ignores drafts and releases that are not desktop ones', () => {
        expect(pickLatestDesktopReleaseTag([
            { tag_name: 'qaap-master-1.71-pre173' },
            { tag_name: 'desktop-v9.0.0', draft: true },
            { tag_name: 'desktop-v1.2.3-beta.1' },
            { tag_name: 'desktop-v0.1.0' }
        ])).to.equal('desktop-v0.1.0');
    });

    it('returns undefined when there is no desktop release', () => {
        expect(pickLatestDesktopReleaseTag([])).to.equal(undefined);
        expect(pickLatestDesktopReleaseTag([{ tag_name: 'v1.0.0' }, { tag_name: 42 }])).to.equal(undefined);
    });
});
