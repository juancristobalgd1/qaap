// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();
FrontendApplicationConfigProvider.set({});

import { expect } from 'chai';
import { MCPServerStatus } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { QaapGithubMcpOnDemandStarter } from './qaap-github-mcp-on-demand-starter';

disableJSDOM();

describe('QaapGithubMcpOnDemandStarter', () => {

    interface Calls {
        started: number;
        checks: number;
    }

    function createStarter(options: {
        running?: boolean;
        credential?: boolean;
        status?: MCPServerStatus;
        startError?: Error;
        startDelayMs?: number;
    }): { starter: QaapGithubMcpOnDemandStarter; calls: Calls } {
        const calls: Calls = { started: 0, checks: 0 };
        let running = !!options.running;
        const mcpService = {
            isServerStarted: async (): Promise<boolean> => running,
            hasStoredOAuthCredentials: async (): Promise<boolean> => { calls.checks++; return options.credential !== false; },
            startServer: async (): Promise<void> => {
                calls.started++;
                if (options.startDelayMs) {
                    await new Promise(resolve => setTimeout(resolve, options.startDelayMs));
                }
                if (options.startError) {
                    throw options.startError;
                }
                running = true;
            },
            getServerDescription: async (): Promise<{ status: MCPServerStatus } | undefined> => ({ status: options.status ?? MCPServerStatus.Connected }),
        };
        const starter = new QaapGithubMcpOnDemandStarter();
        Object.assign(starter, { mcpService });
        return { starter, calls };
    }

    it('reports started and starts the server when a credential exists', async () => {
        const { starter, calls } = createStarter({});
        expect(await starter.ensureStarted()).to.equal('started');
        expect(calls.started).to.equal(1);
        expect(starter.getLastOutcome()).to.equal('started');
    });

    it('never starts the server without a credential', async () => {
        const { starter, calls } = createStarter({ credential: false });
        expect(await starter.ensureStarted()).to.equal('needs-credential');
        expect(calls.started).to.equal(0);
        expect(starter.getLastOutcome()).to.equal('needs-credential');
    });

    it('reports auth-required when GitHub refuses the token', async () => {
        const { starter } = createStarter({ status: MCPServerStatus.AuthenticationRequired });
        expect(await starter.ensureStarted()).to.equal('auth-required');
    });

    it('reports error when starting throws, and tries again on the next call', async () => {
        const { starter, calls } = createStarter({ startError: new Error('boom') });
        expect(await starter.ensureStarted()).to.equal('error');
        expect(await starter.ensureStarted()).to.equal('error');
        expect(calls.started).to.equal(2);
    });

    it('starts the server once for two concurrent turns', async () => {
        const { starter, calls } = createStarter({ startDelayMs: 20 });
        const [first, second] = await Promise.all([starter.ensureStarted(), starter.ensureStarted()]);
        expect(first).to.equal('started');
        expect(second).to.equal('started');
        expect(calls.started).to.equal(1);
    });

    it('does not start again when the server already runs', async () => {
        const { starter, calls } = createStarter({ running: true });
        expect(await starter.ensureStarted()).to.equal('started');
        expect(calls.started).to.equal(0);
    });

    it('fires onDidChange with each completed outcome', async () => {
        const { starter } = createStarter({ credential: false });
        const seen: string[] = [];
        starter.onDidChange(outcome => seen.push(outcome));
        await starter.ensureStarted();
        expect(seen).to.deep.equal(['needs-credential']);
    });
});
