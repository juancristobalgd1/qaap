// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    collectTrustedBootstrapPreviewPorts,
    ensureTranscriptDevPreview,
    extractDevPreviewPortFromUrl,
} from './qaap-transcript-preview-bootstrap';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';

describe('qaap-transcript-preview-bootstrap', () => {
    it('extractDevPreviewPortFromUrl reads qaap-dev proxy paths', () => {
        expect(extractDevPreviewPortFromUrl('http://localhost:3000/qaap-dev/5173/')).to.equal(5173);
        expect(extractDevPreviewPortFromUrl('http://localhost:3000/qaap-dev/5184/app')).to.equal(5184);
    });

    it('extractDevPreviewPortFromUrl reads direct localhost URLs', () => {
        expect(extractDevPreviewPortFromUrl('http://localhost:5173/')).to.equal(5173);
        expect(extractDevPreviewPortFromUrl('http://127.0.0.1:3001')).to.equal(3001);
    });

    it('only probes ports tied to the current workspace bootstrap history', () => {
        expect(collectTrustedBootstrapPreviewPorts({
            previewUrl: 'http://localhost:3000/qaap-dev/5180/',
            lastPort: 5179,
            activePort: 5180,
        })).to.deep.equal([5180, 5179]);
        expect(collectTrustedBootstrapPreviewPorts({})).to.deep.equal([]);
    });

    it('never falls back to the current workspace when an explicit project root yields no descriptor', async () => {
        // Regression guard for the cross-project previewUrl poisoning: with workspace A open and a
        // transcript of project B whose root is unrunnable, the old code refreshed from the CURRENT
        // workspace and returned project A's preview URL as project B's.
        const calls: string[] = [];
        const bootstrap = {
            refreshFromProjectRoot: async (root: string, projectId: string): Promise<void> => {
                calls.push(`root:${root}:${projectId}`);
            },
            refreshFromCurrentWorkspace: async (): Promise<void> => {
                calls.push('current-workspace');
            },
            getStateSnapshot: () => ({ descriptor: undefined }),
        } as unknown as QaapProjectBootstrapService;

        const result = await ensureTranscriptDevPreview(bootstrap, {
            projectId: 'github:owner/project-b',
            workspaceRoot: '/workspace/repos/users/owner/owner/project-b',
            skipConversationPortProbe: true,
        });

        expect(result).to.equal(undefined);
        expect(calls).to.deep.equal(['root:/workspace/repos/users/owner/owner/project-b:github:owner/project-b']);
    });

    it('deduplicates concurrent bootstrap requests for the same service', async () => {
        let releaseRefresh!: () => void;
        const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
        let refreshCalls = 0;
        const bootstrap = {
            refreshFromProjectRoot: async (): Promise<void> => {
                refreshCalls++;
                await refreshGate;
            },
            getStateSnapshot: () => ({ descriptor: undefined }),
        } as unknown as QaapProjectBootstrapService;

        const first = ensureTranscriptDevPreview(bootstrap, {
            workspaceRoot: '/workspace/repos/project',
            projectId: 'project',
            skipConversationPortProbe: true,
        });
        const second = ensureTranscriptDevPreview(bootstrap, {
            workspaceRoot: '/workspace/repos/project',
            projectId: 'project',
            skipConversationPortProbe: true,
        });

        expect(second).to.equal(first);
        releaseRefresh();
        await Promise.all([first, second]);
        expect(refreshCalls).to.equal(1);
    });
});
