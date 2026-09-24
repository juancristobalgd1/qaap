// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

const browserGlobals = globalThis as unknown as { DragEvent?: unknown };
if (!browserGlobals.DragEvent) {
    browserGlobals.DragEvent = class DragEvent { };
}

import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { resolveAgentLoginCwd } from './qaap-agent-login-cwd';
import { useSuiteJSDOM } from './test/qaap-jsdom-suite';

disableImportJSDOM();

const project = {
    id: 'github:octocat/Hello-World',
    github: {
        owner: 'octocat',
        name: 'Hello-World',
        fullName: 'octocat/Hello-World',
        htmlUrl: 'https://github.com/octocat/Hello-World',
        private: false,
    },
} as MobileProjectEntry;

const summary = {
    id: 'conversation-1',
    source: 'qaap-agent',
    cwd: '/workspace',
    agentId: 'codex',
    title: 'Connect Codex',
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
} satisfies QaapAgentConversationSummaryDTO;

describe('resolveAgentLoginCwd', () => {

    useSuiteJSDOM();

    it('prepares the selected repository before using a container cwd from the summary', async () => {
        const prepared = '/workspace/repos/users/alice/octocat/Hello-World';
        let prepareCalls = 0;
        const preparedCwdByProjectId = new Map<string, string>();
        const ctx = {
            projectsService: {
                getProjectCwd: () => '/workspace',
                prepareProjectCwd: async () => {
                    prepareCalls++;
                    return prepared;
                },
            },
            preparedCwdByProjectId,
            transcriptSurfacesUi: {
                resolveTranscriptProjectCwd: () => '/workspace',
            },
        };

        expect(await resolveAgentLoginCwd(ctx, project, summary)).to.equal(prepared);
        expect(prepareCalls).to.equal(1);
        expect(preparedCwdByProjectId.get(project.id)).to.equal(prepared);
    });

    it('keeps a concrete cached project cwd without reopening the repository', async () => {
        const cached = '/workspace/repos/users/alice/octocat/Hello-World';
        let prepareCalls = 0;
        const ctx = {
            projectsService: {
                getProjectCwd: () => cached,
                prepareProjectCwd: async () => {
                    prepareCalls++;
                    return undefined;
                },
            },
            preparedCwdByProjectId: new Map<string, string>(),
        };

        expect(await resolveAgentLoginCwd(ctx, project, summary)).to.equal(cached);
        expect(prepareCalls).to.equal(0);
    });
});
