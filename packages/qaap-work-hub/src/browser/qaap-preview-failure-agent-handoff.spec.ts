// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { Emitter } from '@theia/core/lib/common/event';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { QaapBootstrapStateChange, QaapProjectBootstrapService } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-service';
import { attachQaapPreviewFailureAgentHandoff } from './qaap-preview-failure-agent-handoff';
import { setQaapPreviewConfigForTests } from '@theia/qaap-shared-core/lib/browser/qaap-agent-preview-client';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

const REPO = '/workspace/repos/users/me/me/vyyq';

const summary = (id: string, cwd: string, status: QaapAgentConversationSummaryDTO['status'] = 'idle'): QaapAgentConversationSummaryDTO => ({
    id, cwd, status, agentId: 'opencode', title: id, createdAt: 0, updatedAt: 0, messageCount: 2,
} as QaapAgentConversationSummaryDTO);

const failed = (runId: string, failureKind: QaapBootstrapStateChange['failureKind'] = 'process-exit'): QaapBootstrapStateChange => ({
    phase: 'run-failed',
    failureKind,
    error: 'The dev command exited with code 0 without listening on port 3000.',
    previewLogTail: 'Import trace for requested module:\n./app/globals.css',
    previewRunId: runId,
    descriptor: { rootUri: URI.fromFilePath(REPO), devCommand: 'npm exec -- next dev' } as QaapBootstrapStateChange['descriptor'],
});

describe('attachQaapPreviewFailureAgentHandoff', () => {
    useSuiteJSDOM();

    let posted: Array<{ url: string; body: { content?: string } }>;
    let originalFetch: typeof fetch | undefined;

    beforeEach(() => {
        posted = [];
        originalFetch = (globalThis as { fetch?: typeof fetch }).fetch;
        (globalThis as { fetch?: unknown }).fetch = async (url: string, init?: { body?: string }) => {
            posted.push({ url, body: JSON.parse(init?.body ?? '{}') });
            return { ok: true, status: 200, json: async () => ({ id: 'c1', messages: [] }) } as unknown as Response;
        };
    });

    afterEach(() => {
        (globalThis as { fetch?: unknown }).fetch = originalFetch;
    });

    const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

    it('sends an app failure once to the open task of that project, even with several panels attached', async () => {
        const emitter = new Emitter<QaapBootstrapStateChange>();
        const bootstrap = { onStateChange: emitter.event } as unknown as QaapProjectBootstrapService;
        const hidden = attachQaapPreviewFailureAgentHandoff(bootstrap, () => summary('other', '/workspace/repos/users/me/me/else'));
        const visible = attachQaapPreviewFailureAgentHandoff(bootstrap, () => summary('c1', REPO));

        emitter.fire(failed('run-a'));
        emitter.fire(failed('run-a'));
        await flush();

        expect(posted).to.have.length(1);
        expect(posted[0].url).to.contain('/c1/messages');
        expect(posted[0].body.content).to.contain('./app/globals.css');

        emitter.fire(failed('run-b', 'port-conflict'));
        await flush();
        expect(posted, 'host problems stay with Qaap').to.have.length(1);

        hidden.dispose();
        visible.dispose();
        emitter.fire(failed('run-c'));
        await flush();
        expect(posted, 'detached').to.have.length(1);
    });

    it('waits while the agent is still working', async () => {
        const emitter = new Emitter<QaapBootstrapStateChange>();
        const bootstrap = { onStateChange: emitter.event } as unknown as QaapProjectBootstrapService;
        const attached = attachQaapPreviewFailureAgentHandoff(bootstrap, () => summary('c2', REPO, 'streaming'));
        emitter.fire(failed('run-z'));
        await flush();
        expect(posted).to.deep.equal([]);
        attached.dispose();
    });

    it('never auto-sends a fix turn when agent-driven preview mode is active (D5)', async () => {
        setQaapPreviewConfigForTests({ agentDriven: true, previewService: true, agentPreviewTools: true });
        try {
            const emitter = new Emitter<QaapBootstrapStateChange>();
            const bootstrap = { onStateChange: emitter.event } as unknown as QaapProjectBootstrapService;
            const attached = attachQaapPreviewFailureAgentHandoff(bootstrap, () => summary('c3', REPO));
            emitter.fire(failed('run-agent-driven'));
            await flush();
            expect(posted).to.deep.equal([]);
            attached.dispose();
        } finally {
            setQaapPreviewConfigForTests(undefined);
        }
    });
});
