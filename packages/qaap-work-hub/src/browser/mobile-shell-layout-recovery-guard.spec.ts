// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { RESET_LAYOUT } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import { MobileShellSessionState } from '@theia/qaap-shared-core/lib/browser/mobile-shell-session-state';
import { QAAP_MOBILE_PREFER_AGENTS_SURFACE_KEY } from '@theia/qaap-shared-core/lib/common/qaap-mobile-work-surface-preference';
import type { MobileOneColumnShellContributionContext } from './mobile-one-column-shell-contribution-context';
import {
    hasLayoutRecoveryBeenAttemptedExtracted,
    markLayoutRecoveryAttemptedExtracted,
    runLayoutRecoveryGuardExtracted,
} from './mobile-one-column-shell-contribution-streaming';
import { LAYOUT_RECOVERY_MAX_WAITS, QAAP_LAYOUT_RECOVERY_ATTEMPTED_KEY } from './mobile-shell-layout-recovery';

disableImportJSDOM();

interface GuardHarness {
    ctx: MobileOneColumnShellContributionContext;
    sessionState: MobileShellSessionState;
    executed: string[];
    rearmed: number[];
    surfacePresent: boolean;
}

function createGuardHarness(): GuardHarness {
    const harness = {
        sessionState: new MobileShellSessionState(),
        executed: [] as string[],
        rearmed: [] as number[],
        surfacePresent: false,
    } as GuardHarness;
    const ctx = {
        sessionState: harness.sessionState,
        isWorkHubSurfacePresentInDom: () => harness.surfacePresent,
        hasLayoutRecoveryBeenAttempted: () => hasLayoutRecoveryBeenAttemptedExtracted(ctx),
        markLayoutRecoveryAttempted: () => markLayoutRecoveryAttemptedExtracted(ctx),
        armLayoutRecoveryGuard: (waited?: number) => { harness.rearmed.push(waited ?? 0); },
        storageService: { setData: async () => undefined },
        commands: { executeCommand: async (id: string) => { harness.executed.push(id); } },
    } as unknown as MobileOneColumnShellContributionContext;
    harness.ctx = ctx;
    return harness;
}

describe('mobile-shell layout recovery guard (Work Hub boot)', () => {

    let disableJSDOM: (() => void) | undefined;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
        sessionStorage.clear();
    });

    afterEach(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('does not reload a normal load whose Agents bootstrap is still mounting the hub', async () => {
        // Cold load: 'ready' + 2 s arrives while restoreAgentsSurfaceAfterReload still awaits the
        // workspace and the project list, so the DOM has no Work Hub yet. Reloading here was the
        // second "loading modules..." of every fresh tab.
        const harness = createGuardHarness();
        harness.sessionState.agentsBootstrapStarted = true;
        await runLayoutRecoveryGuardExtracted(harness.ctx);
        expect(harness.executed).to.deep.equal([]);
        expect(sessionStorage.getItem(QAAP_LAYOUT_RECOVERY_ATTEMPTED_KEY)).to.equal(null);
        expect(harness.rearmed).to.deep.equal([1]);
    });

    it('stays quiet once the pending mount lands', async () => {
        const harness = createGuardHarness();
        harness.sessionState.agentsBootstrapStarted = true;
        await runLayoutRecoveryGuardExtracted(harness.ctx);
        harness.sessionState.agentsBootstrapStarted = false;
        harness.surfacePresent = true;
        await runLayoutRecoveryGuardExtracted(harness.ctx, harness.rearmed[0]);
        expect(harness.executed).to.deep.equal([]);
        expect(harness.rearmed).to.deep.equal([1]);
    });

    it('does not double boot after switching back from the IDE to Work Hub', async () => {
        // The mode switch reloads once into the Agents surface; that boot mounts asynchronously too.
        sessionStorage.setItem(QAAP_MOBILE_PREFER_AGENTS_SURFACE_KEY, '1');
        const harness = createGuardHarness();
        harness.sessionState.agentsBootstrapStarted = true;
        await runLayoutRecoveryGuardExtracted(harness.ctx);
        expect(harness.executed).to.deep.equal([]);
    });

    it('still recovers a blank shell exactly once when nothing is mounting', async () => {
        const harness = createGuardHarness();
        await runLayoutRecoveryGuardExtracted(harness.ctx);
        expect(harness.executed).to.deep.equal([RESET_LAYOUT.id]);
        // The reloaded page finds the flag and stops instead of looping.
        const reloaded = createGuardHarness();
        await runLayoutRecoveryGuardExtracted(reloaded.ctx);
        expect(reloaded.executed).to.deep.equal([]);
    });

    it('treats a mount that never settles as hung and recovers it', async () => {
        const harness = createGuardHarness();
        harness.sessionState.agentsBootstrapStarted = true;
        await runLayoutRecoveryGuardExtracted(harness.ctx, LAYOUT_RECOVERY_MAX_WAITS);
        expect(harness.executed).to.deep.equal([RESET_LAYOUT.id]);
    });
});
