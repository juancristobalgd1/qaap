// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();
FrontendApplicationConfigProvider.set({});

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import type { QaapGithubMcpConnectionSnapshot } from '@theia/qaap-shared-core/lib/browser/qaap-github-mcp-connection-state';
import { QaapGithubMcpConnectionStateImpl } from './qaap-github-mcp-connection-state-impl';
import type { QaapGithubMcpStartOutcome } from './qaap-github-mcp-on-demand-starter';

disableJSDOM();

describe('QaapGithubMcpConnectionStateImpl', () => {

    class TestState extends QaapGithubMcpConnectionStateImpl {
        signIns = 0;
        protected override openGithubSignIn(): void {
            this.signIns++;
        }
    }

    function create(options: { mode?: 'desktop' | 'tenant'; trustGranted?: boolean; running?: boolean } = {}): {
        state: TestState; outcomes: Emitter<QaapGithubMcpStartOutcome | undefined>; servers: Emitter<void>; resets: number[]; trustRequests: number[];
    } {
        const outcomes = new Emitter<QaapGithubMcpStartOutcome | undefined>();
        const servers = new Emitter<void>();
        const resets: number[] = [];
        const trustRequests: number[] = [];
        let last: QaapGithubMcpStartOutcome | undefined;
        outcomes.event(outcome => { last = outcome; });
        const starter = {
            onDidChange: outcomes.event,
            getLastOutcome: () => last,
            getLastStatus: () => ({ available: true, source: undefined, mode: options.mode ?? 'tenant', rejectedByPolicy: false }),
            reset: () => { resets.push(1); last = undefined; outcomes.fire(undefined); },
        };
        const state = new TestState();
        Object.assign(state, {
            starter,
            notifications: { onDidUpdateMCPServers: servers.event },
            mcpService: { isServerStarted: async () => !!options.running },
            workspaceTrustService: { requestWorkspaceTrust: async () => { trustRequests.push(1); return options.trustGranted; } },
        });
        (state as unknown as { init(): void }).init();
        return { state, outcomes, servers, resets, trustRequests };
    }

    it('follows the start outcomes, with the desktop flag from the credential status', () => {
        const { state, outcomes } = create({ mode: 'desktop' });
        const seen: QaapGithubMcpConnectionSnapshot[] = [];
        state.onDidChange(snapshot => seen.push(snapshot));
        expect(state.snapshot.kind).to.equal('unknown');
        outcomes.fire('needs-credential');
        outcomes.fire('started');
        expect(seen).to.deep.equal([{ kind: 'needs-credential', desktop: true }, { kind: 'connected', desktop: true }]);
    });

    it('opens GitHub sign-in for needs-credential and auth-required, and nothing for policy-rejected', async () => {
        const { state, outcomes } = create();
        outcomes.fire('needs-credential');
        await state.connect();
        outcomes.fire('auth-required');
        await state.connect();
        outcomes.fire('policy-rejected');
        await state.connect();
        expect(state.signIns).to.equal(2);
    });

    it('asks for workspace trust when untrusted and clears the chip once granted', async () => {
        const denied = create({ trustGranted: false });
        denied.outcomes.fire('untrusted');
        await denied.state.connect();
        expect(denied.trustRequests).to.have.length(1);
        expect(denied.resets).to.have.length(0);
        expect(denied.state.snapshot.kind).to.equal('untrusted');

        const granted = create({ trustGranted: true });
        granted.outcomes.fire('untrusted');
        await granted.state.connect();
        expect(granted.resets).to.have.length(1);
        expect(granted.state.snapshot.kind).to.equal('unknown');
        expect(granted.state.signIns).to.equal(0);
    });

    it('clears a pending chip when a server update shows the managed server running', async () => {
        const { state, outcomes, servers } = create({ running: true });
        outcomes.fire('auth-required');
        servers.fire();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(state.snapshot.kind).to.equal('connected');
    });
});
