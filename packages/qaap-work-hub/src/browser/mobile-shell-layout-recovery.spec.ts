// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    decideLayoutRecovery,
    LayoutRecoveryDecisionInput,
    QAAP_LAYOUT_RECOVERY_ATTEMPTED_KEY,
    SHELL_LAYOUT_STORAGE_KEY,
} from './mobile-shell-layout-recovery';

describe('mobile-shell-layout-recovery', () => {

    const base: LayoutRecoveryDecisionInput = {
        workHubSurfacePresent: false,
        preferDesktopIde: false,
        recoveryAlreadyAttempted: false,
    };

    it('recovers when the Work Hub never mounted and no recovery has run yet', () => {
        expect(decideLayoutRecovery({ ...base })).to.equal('recover');
    });

    it('is a no-op when the Work Hub surface is present', () => {
        expect(decideLayoutRecovery({ ...base, workHubSurfacePresent: true })).to.equal('noop');
    });

    it('is a no-op when the user explicitly chose the desktop IDE', () => {
        expect(decideLayoutRecovery({ ...base, preferDesktopIde: true })).to.equal('noop');
    });

    it('prefers the IDE opt-out over recovery even if the hub is absent', () => {
        expect(decideLayoutRecovery({ ...base, preferDesktopIde: true, workHubSurfacePresent: false })).to.equal('noop');
    });

    it('aborts to avoid a reload loop when a recovery was already attempted', () => {
        expect(decideLayoutRecovery({ ...base, recoveryAlreadyAttempted: true })).to.equal('abort-loop');
    });

    it('does not abort or recover when the hub is present even after a prior attempt', () => {
        expect(decideLayoutRecovery({
            ...base,
            workHubSurfacePresent: true,
            recoveryAlreadyAttempted: true,
        })).to.equal('noop');
    });

    it('does not attempt a second recovery once the flag is set and the hub is still missing', () => {
        // First boot: hub missing, no prior attempt -> recover.
        expect(decideLayoutRecovery({ ...base })).to.equal('recover');
        // Reloaded boot: hub still missing, flag now set -> abort (no loop).
        expect(decideLayoutRecovery({ ...base, recoveryAlreadyAttempted: true })).to.equal('abort-loop');
    });

    describe('full matrix (hub x ide x attempted)', () => {
        const expected: Record<string, string> = {
            // hubPresent | preferIde | attempted
            'false|false|false': 'recover',
            'false|false|true': 'abort-loop',
            'false|true|false': 'noop',
            'false|true|true': 'noop',
            'true|false|false': 'noop',
            'true|false|true': 'noop',
            'true|true|false': 'noop',
            'true|true|true': 'noop',
        };
        for (const [key, decision] of Object.entries(expected)) {
            const [hub, ide, attempted] = key.split('|').map(v => v === 'true');
            it(`hub=${hub} ide=${ide} attempted=${attempted} -> ${decision}`, () => {
                expect(decideLayoutRecovery({
                    workHubSurfacePresent: hub,
                    preferDesktopIde: ide,
                    recoveryAlreadyAttempted: attempted,
                })).to.equal(decision);
            });
        }
    });

    it('exposes stable storage/session keys', () => {
        expect(SHELL_LAYOUT_STORAGE_KEY).to.equal('layout');
        expect(QAAP_LAYOUT_RECOVERY_ATTEMPTED_KEY).to.equal('qaap.layoutRecovery.attempted');
    });
});
