// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import URI from '@theia/core/lib/common/uri';
import type { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import type { QaapProjectBootstrapServiceContext } from './qaap-project-bootstrap-service-context';
import type { QaapPreviewPortClaimResult } from '@theia/qaap-adapters/lib/browser/qaap-preview-port-claim-service';

const PREVIEW_ID = 'preview-a';
const CWD = URI.fromFilePath('/workspace/app');

interface RememberedClaim { previewId: string; previewUrl: string; port: number }

/** Lets the pending microtasks of `processId.then(...)` and the awaited claim settle. */
async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

function fakeContext(options: {
    readonly active: RememberedClaim | undefined;
    readonly reserve: () => Promise<QaapPreviewPortClaimResult>;
}): { ctx: QaapProjectBootstrapServiceContext; remembered: RememberedClaim[]; reserveCalls: number[] } {
    const remembered: RememberedClaim[] = [];
    const reserveCalls: number[] = [];
    const state: { activePreviewClaim: RememberedClaim | undefined } = { activePreviewClaim: options.active };
    const ctx = {
        get activePreviewClaim(): RememberedClaim | undefined { return state.activePreviewClaim; },
        reserveActivePreview: async (_port: number, _cwd: URI, pid?: number): Promise<QaapPreviewPortClaimResult> => {
            reserveCalls.push(pid ?? -1);
            return options.reserve();
        },
        rememberActivePreviewClaim: (claim: RememberedClaim): void => {
            remembered.push(claim);
            state.activePreviewClaim = claim;
        },
    } as unknown as QaapProjectBootstrapServiceContext;
    return { ctx, remembered, reserveCalls };
}

function fakeTerminal(pid: number): TerminalWidget {
    return { processId: Promise.resolve(pid) } as unknown as TerminalWidget;
}

describe('qaap-project-bootstrap-service-timeline attachTerminalOsProcessIdExtracted', () => {
    let attachTerminalOsProcessIdExtracted: typeof import('./qaap-project-bootstrap-service-timeline').attachTerminalOsProcessIdExtracted;
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
        // Same stub as the dev-run-guards spec: the mini-browser preview frame pulls the whole
        // mini-browser DI graph into a unit test and sits in an import cycle with the service.
        const frameModule = require.resolve('@theia/qaap-adapters/lib/browser/qaap-mini-browser-preview-frame');
        require.cache[frameModule] = {
            id: frameModule,
            filename: frameModule,
            loaded: true,
            exports: { syncQaapMiniBrowserPreviewSuspension: () => undefined },
        } as NodeJS.Module;
        ({ attachTerminalOsProcessIdExtracted } = require('./qaap-project-bootstrap-service-timeline'));
    });

    after(() => disableJSDOM?.());

    it('re-claims with the terminal pid and keeps the claim when the backend answers the same identity', async () => {
        const same: RememberedClaim = { previewId: PREVIEW_ID, previewUrl: 'https://p/qaap-preview/a/', port: 5173 };
        const { ctx, remembered, reserveCalls } = fakeContext({
            active: same,
            reserve: async () => ({ kind: 'claimed', ...same }),
        });
        attachTerminalOsProcessIdExtracted(ctx, fakeTerminal(4242), PREVIEW_ID, 5173, CWD);
        await flush();
        expect(reserveCalls).to.deep.equal([4242]);
        expect(remembered).to.deep.equal([]);
    });

    it('remembers the identity the backend answered when it differs from the remembered claim', async () => {
        const started: RememberedClaim = { previewId: PREVIEW_ID, previewUrl: 'https://p/qaap-preview/a/', port: 5173 };
        const answered = { previewId: 'preview-b', previewUrl: 'https://p/qaap-preview/b/', port: 5174 };
        const { ctx, remembered } = fakeContext({
            active: started,
            reserve: async () => ({ kind: 'claimed', ...answered }),
        });
        attachTerminalOsProcessIdExtracted(ctx, fakeTerminal(4242), PREVIEW_ID, 5173, CWD);
        await flush();
        expect(remembered).to.deep.equal([answered]);
    });

    it('does nothing when the backend reports a conflict or error', async () => {
        const started: RememberedClaim = { previewId: PREVIEW_ID, previewUrl: 'https://p/qaap-preview/a/', port: 5173 };
        const { ctx, remembered } = fakeContext({
            active: started,
            reserve: async () => ({ kind: 'conflict' }),
        });
        attachTerminalOsProcessIdExtracted(ctx, fakeTerminal(4242), PREVIEW_ID, 5173, CWD);
        await flush();
        expect(remembered).to.deep.equal([]);
    });

    it('does not reserve when the active claim is another preview', async () => {
        const other: RememberedClaim = { previewId: 'preview-other', previewUrl: 'https://p/qaap-preview/o/', port: 5180 };
        const { ctx, remembered, reserveCalls } = fakeContext({
            active: other,
            reserve: async () => ({ kind: 'claimed', previewId: 'x', previewUrl: 'https://p/x/', port: 1 }),
        });
        attachTerminalOsProcessIdExtracted(ctx, fakeTerminal(4242), PREVIEW_ID, 5173, CWD);
        await flush();
        expect(reserveCalls).to.deep.equal([]);
        expect(remembered).to.deep.equal([]);
    });
});
