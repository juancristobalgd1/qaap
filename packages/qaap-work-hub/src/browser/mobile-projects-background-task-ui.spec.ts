// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { writeStoredAgentModel } from '@theia/qaap-shared-core/lib/common/qaap-agent-model-selection';
import { MobileProjectsBackgroundTaskUi } from './mobile-projects-background-task-ui';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { localizeMissingQaiqMessage } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { requestStopNewTaskStartup } from '../common/qaap-new-task-startup';

disableImportJSDOM();

describe('MobileProjectsBackgroundTaskUi', () => {

    useSuiteJSDOM();

    function withAgentSnapshot(snapshot: {
        agents: Array<{ id: string; label: string; available: boolean }>;
        agentConfigured: boolean;
        defaultAgent?: string;
        qaiqInstalled: boolean;
        qaiqModels: [];
    }): MobileProjectsBackgroundTaskUi {
        const ui = new MobileProjectsBackgroundTaskUi({
            projects: [],
            preparedCwdByProjectId: new Map(),
            justAddedTaskId: undefined,
            agentsHubShellActive: false,
            projectsService: {} as never,
            delegate: {},
            transcriptSheetUi: {} as never,
            transcriptLiveUi: {} as never,
            shouldUseAgentsHubLanding: () => false,
            renderSubtitle: () => undefined,
            renderList: () => undefined,
            seedTranscriptOptimisticSubmit: () => undefined,
            syncWorkHubProjectSkillRoots: () => undefined,
        });
        ui.loadBackendAgentSnapshot = async () => snapshot;
        return ui;
    }

    it('allows an explicit local Codex selection when QAIQ is unavailable', async () => {
        const ui = withAgentSnapshot({
            agents: [{ id: 'codex', label: 'Codex', available: true }],
            agentConfigured: true,
            defaultAgent: 'codex',
            qaiqInstalled: false,
            qaiqModels: [],
        });

        expect(await ui.selectBackendConversationAgent('/repo', 'fix it', 'codex')).to.equal('codex');
    });

    it('accepts an explicit shell selection without waiting for the VPS agent catalog', async () => {
        const ui = withAgentSnapshot({
            agents: [],
            agentConfigured: false,
            qaiqInstalled: false,
            qaiqModels: [],
        });
        let catalogRead = false;
        ui.loadBackendAgentSnapshot = async () => {
            catalogRead = true;
            throw new Error('catalog should not be needed for shell');
        };

        expect(await ui.selectBackendConversationAgent('/repo', 'printf ok', '@shell')).to.equal('shell');
        expect(catalogRead).to.equal(false);
    });

    it('accepts an explicit builtin harness without waiting for the VPS agent catalog', async () => {
        const ui = withAgentSnapshot({
            agents: [],
            agentConfigured: false,
            qaiqInstalled: false,
            qaiqModels: [],
        });
        let catalogRead = false;
        ui.loadBackendAgentSnapshot = async () => {
            catalogRead = true;
            throw new Error('catalog should not be needed for an explicit harness');
        };

        expect(await ui.selectBackendConversationAgent('/repo', 'fix it', '@codex')).to.equal('codex');
        expect(catalogRead).to.equal(false);
    });

    it('keeps the localized QAIQ error when the resolved default agent is QAIQ', async () => {
        const ui = withAgentSnapshot({
            agents: [{ id: 'qaiq', label: 'QAIQ', available: true }],
            agentConfigured: true,
            defaultAgent: 'qaiq',
            qaiqInstalled: false,
            qaiqModels: [],
        });

        try {
            await ui.selectBackendConversationAgent('/repo', 'fix it');
            expect.fail('expected missing QAIQ error');
        } catch (error) {
            expect(error).to.be.an('error');
            expect((error as Error).message).to.equal(localizeMissingQaiqMessage());
        }
    });

    it('ensureInlineComposerCwd prefers open workspace when hub project differs (QA-001)', async () => {
        const mockup: MobileProjectEntry = {
            id: 'mockup',
            name: 'Mockup',
            color: '#000',
            branch: 'main',
            status: 'idle',
            task: '',
            progress: 0,
            agents: [],
            lastActive: '',
            tokens: '—',
            cost: '—',
            pinned: false,
            // This project IS the currently open workspace (the mock's
            // projectMatchesCurrentWorkspace only returns true when isCurrent === true).
            // ensureInlineComposerCwd must then prefer the live workspace cwd over the
            // project's stored getProjectCwd path.
            isCurrent: true,
        };
        const prepared = new Map<string, string>();
        const projectsService = {
            getCurrentWorkspaceCwd: () => '/tmp/qaap-ui-ws-empty',
            projectMatchesCurrentWorkspace: (project: MobileProjectEntry) => project.id === 'mockup' && project.isCurrent === true,
            getProjectCwd: () => '/Users/jc/.qaap/workspaces/u/Mockup',
            prepareProjectCwd: async () => undefined,
        };
        const ui = new MobileProjectsBackgroundTaskUi({
            projects: [],
            preparedCwdByProjectId: prepared,
            justAddedTaskId: undefined,
            agentsHubShellActive: false,
            projectsService: projectsService as never,
            delegate: {},
            transcriptSheetUi: {} as never,
            transcriptLiveUi: {} as never,
            shouldUseAgentsHubLanding: () => false,
            renderSubtitle: () => undefined,
            renderList: () => undefined,
            seedTranscriptOptimisticSubmit: () => undefined,
            syncWorkHubProjectSkillRoots: () => undefined,
        });

        const cwd = await ui.ensureInlineComposerCwd(mockup);
        expect(cwd).to.equal('/tmp/qaap-ui-ws-empty');
        expect(prepared.get('mockup')).to.equal('/tmp/qaap-ui-ws-empty');
    });

    it('clears the just-added flash in place after 1.4s instead of rebuilding the whole list', () => {
        const project: MobileProjectEntry = {
            id: 'p1', name: 'P1', color: '#000', branch: 'main', status: 'idle', task: '',
            progress: 0, agents: [], lastActive: '', tokens: '—', cost: '—', pinned: false,
            isCurrent: false,
        };
        const item = document.createElement('button');
        item.className = 'theia-mobile-projects-task-item theia-mod-flash';
        document.body.append(item);

        let renderListCalls = 0;
        const ui = new MobileProjectsBackgroundTaskUi({
            projects: [project],
            preparedCwdByProjectId: new Map(),
            justAddedTaskId: undefined,
            agentsHubShellActive: false,
            projectsService: { getProjectCwd: () => '/repo' } as never,
            delegate: { onProjectsChanged: () => undefined },
            transcriptSheetUi: {} as never,
            transcriptLiveUi: {} as never,
            shouldUseAgentsHubLanding: () => false,
            renderSubtitle: () => undefined,
            renderList: () => { renderListCalls++; },
            seedTranscriptOptimisticSubmit: () => undefined,
            syncWorkHubProjectSkillRoots: () => undefined,
        } as never);

        const realSetTimeout = window.setTimeout;
        let deferred: (() => void) | undefined;
        window.setTimeout = ((handler: TimerHandler) => {
            if (typeof handler === 'function') {
                deferred = handler as () => void;
            }
            return 1 as unknown as number;
        }) as typeof setTimeout;

        try {
            (ui as unknown as {
                applyTaskStartedToProject: (cwd: string, title: string, taskId: string) => void;
            }).applyTaskStartedToProject('/repo', 'New task', 'task-1');

            // Initial paint is a single full render; the flash is still on.
            expect(renderListCalls).to.equal(1);
            expect((ui as unknown as { host: { justAddedTaskId?: string } }).host.justAddedTaskId).to.equal('task-1');
            expect(item.classList.contains('theia-mod-flash')).to.equal(true);

            // The 1.4s cleanup strips the flash class WITHOUT a second full render.
            deferred?.();
            expect(item.classList.contains('theia-mod-flash')).to.equal(false);
            expect(renderListCalls).to.equal(1);
            expect((ui as unknown as { host: { justAddedTaskId?: string } }).host.justAddedTaskId).to.equal(undefined);
        } finally {
            window.setTimeout = realSetTimeout;
            item.remove();
        }
    });

    /** Runs createProjectChatSession against a stubbed create POST; returns the sent body and any snackbar text. */
    async function createSession(
        isolation: 'auto' | 'worktree' | undefined,
        worktreeBranch: string | undefined,
    ): Promise<{ body: Record<string, unknown>; snackbar: string | undefined }> {
        const ui = withAgentSnapshot({ agents: [], agentConfigured: false, qaiqInstalled: false, qaiqModels: [] });
        let body: Record<string, unknown> = {};
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
            body = JSON.parse(String(init?.body));
            const conversation = { id: 'conv-1', cwd: '/repo', status: 'streaming', messages: [], createdAt: 1, updatedAt: 1, worktreeBranch };
            return { ok: true, status: 201, json: async () => conversation };
        }) as unknown as typeof globalThis.fetch;
        document.querySelectorAll('.theia-mobile-snackbar-message').forEach(node => node.remove());
        try {
            const project = { id: 'p', name: 'repo' } as MobileProjectEntry;
            await ui.createProjectChatSession(project, '/repo', 'fix it', { selectedAgentId: '@shell', ...(isolation ? { isolation } : {}) });
        } finally {
            globalThis.fetch = originalFetch;
        }
        return { body, snackbar: document.querySelector('.theia-mobile-snackbar-message')?.textContent ?? undefined };
    }

    it('passes the requested isolation through and leaves the default to the server', async () => {
        expect((await createSession('worktree', 'qaap/worktree/a')).body.isolation).to.equal('worktree');
        expect((await createSession('auto', undefined)).body.isolation).to.equal('auto');
        const omitted = await createSession(undefined, undefined);
        expect(omitted.body).to.not.have.property('isolation');
        expect(omitted.body).to.not.have.property('worktree');
    });

    it('announces the isolated worktree only when the server auto-isolated the thread', async () => {
        expect((await createSession('auto', 'qaap/worktree/a')).snackbar).to.contain('isolated worktree');
        expect((await createSession('auto', undefined)).snackbar).to.equal(undefined);
        expect((await createSession('worktree', 'qaap/worktree/a')).snackbar).to.equal(undefined);
    });

    describe('dirty shared workspace on a new task', () => {
        function dirtyResponse(): Response {
            const body = { code: 'dirty_workspace', files: ['README.md', 'hello.txt'], total: 2 };
            const response = { ok: false, status: 409, statusText: 'Conflict', json: async () => body, clone: () => response };
            return response as unknown as Response;
        }

        async function submitOnDirtyTree(choice: 'startClean' | 'continueHere' | undefined, stopWhileDialogOpen = false): Promise<{ bodies: Array<Record<string, unknown>>; result: unknown; rollbacks: number }> {
            const ui = withAgentSnapshot({ agents: [], agentConfigured: false, qaiqInstalled: false, qaiqModels: [] });
            let rollbacks = 0;
            (ui as unknown as { host: { rollbackTranscriptOptimisticSubmit?: () => void } }).host.rollbackTranscriptOptimisticSubmit = () => { rollbacks++; };
            const decision = ui as unknown as {
                askDirtyWorkspaceChoice: (files: readonly string[], total: number) => Promise<'startClean' | 'continueHere' | undefined>;
                createWithDirtyWorkspaceDecision: (project: MobileProjectEntry, cwd: string, draft: string, options: { selectedAgentId?: string }, startup?: { projectId: string; stopRequested: boolean }) => Promise<unknown>;
            };
            const startup = { projectId: 'p', stopRequested: false };
            decision.askDirtyWorkspaceChoice = async () => {
                if (stopWhileDialogOpen) {
                    startup.stopRequested = true;
                }
                return choice;
            };
            const bodies: Array<Record<string, unknown>> = [];
            const originalFetch = globalThis.fetch;
            globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
                bodies.push(JSON.parse(String(init?.body)));
                if (bodies.length === 1) {
                    return dirtyResponse();
                }
                const conversation = { id: 'conv-1', cwd: '/repo', status: 'streaming', messages: [], createdAt: 1, updatedAt: 1 };
                return { ok: true, status: 201, json: async () => conversation };
            }) as unknown as typeof globalThis.fetch;
            try {
                const project = { id: 'p', name: 'repo' } as MobileProjectEntry;
                const result = await decision.createWithDirtyWorkspaceDecision(project, '/repo', 'fix it', { selectedAgentId: '@shell' }, startup);
                return { bodies, result, rollbacks };
            } finally {
                globalThis.fetch = originalFetch;
            }
        }

        it('retries in a clean worktree when the user chooses Start clean', async () => {
            const { bodies, result } = await submitOnDirtyTree('startClean');
            expect(bodies).to.have.length(2);
            expect(bodies[0]).to.not.have.property('acceptDirty');
            expect(bodies[1].isolation).to.equal('worktree');
            expect(result).to.not.equal(undefined);
        });

        it('retries sharing the tree with acceptDirty when the user chooses Continue here', async () => {
            const { bodies, result } = await submitOnDirtyTree('continueHere');
            expect(bodies).to.have.length(2);
            expect(bodies[1].acceptDirty).to.equal(true);
            expect(bodies[1]).to.not.have.property('isolation');
            expect(result).to.not.equal(undefined);
        });

        it('creates no task when Stop is pressed while the dialog is open, even if the user then chooses Continue here', async () => {
            const { bodies, result, rollbacks } = await submitOnDirtyTree('continueHere', true);
            expect(bodies).to.have.length(1);
            expect(result).to.equal(undefined);
            expect(rollbacks).to.equal(1);
        });

        it('creates nothing and resolves undefined (draft restored by the caller) when the dialog is cancelled', async () => {
            const { bodies, result, rollbacks } = await submitOnDirtyTree(undefined);
            expect(bodies).to.have.length(1);
            expect(result).to.equal(undefined);
            expect(rollbacks).to.equal(1);
        });
    });

    describe('paid-send gate on a new task', () => {
        const project = { id: 'p1', name: 'app' } as unknown as MobileProjectEntry;
        const paidModel = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'openai/gpt-5' };
        const freeModel = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'google/gemma-4-31b-it:free' };

        function uiWithInner(): { ui: MobileProjectsBackgroundTaskUi; innerCalls: number[] } {
            const ui = new MobileProjectsBackgroundTaskUi({
                projects: [],
                preparedCwdByProjectId: new Map(),
                justAddedTaskId: undefined,
                agentsHubShellActive: false,
                projectsService: { getProjectCwd: () => '/repo/app' } as never,
                delegate: {},
                transcriptSheetUi: {} as never,
                transcriptLiveUi: {} as never,
                shouldUseAgentsHubLanding: () => false,
                renderSubtitle: () => undefined,
                renderList: () => undefined,
                seedTranscriptOptimisticSubmit: () => undefined,
                syncWorkHubProjectSkillRoots: () => undefined,
            });
            ui['routeSubmitAgent'] = async (): Promise<string> => 'codex';
            const innerCalls: number[] = [];
            ui['submitBackgroundAgentTaskInner'] = async (): Promise<undefined> => {
                innerCalls.push(1);
                return undefined;
            };
            return { ui, innerCalls };
        }

        it('aborts the submit when routing fails: no gate and no send with a different agent', async () => {
            const { ui, innerCalls } = uiWithInner();
            ui['routeSubmitAgent'] = async (): Promise<string> => {
                throw new Error('catalog warming');
            };
            let gated = 0;
            ui['confirmPaidSend'] = async (): Promise<boolean> => {
                gated++;
                return true;
            };
            expect(await ui.submitBackgroundAgentTask(project, 'build it', { agentModel: paidModel })).to.be.undefined;
            expect(gated).to.equal(0);
            expect(innerCalls).to.be.empty;
        });

        it('routes once: the gate and the send carry the same routing agent', async () => {
            const { ui } = uiWithInner();
            let gatedAgent: string | undefined;
            let sentOptions: { resolvedAgentId?: string } | undefined;
            ui['routeSubmitAgent'] = async (): Promise<string> => 'codex';
            ui['confirmPaidSend'] = async (_cwd: string, model: unknown): Promise<boolean> => {
                gatedAgent = (model as { vendor?: string } | undefined)?.vendor;
                return true;
            };
            ui['submitBackgroundAgentTaskInner'] = async (_p: unknown, _d: unknown, options: { resolvedAgentId?: string }): Promise<undefined> => {
                sentOptions = options;
                return undefined;
            };
            await ui.submitBackgroundAgentTask(project, 'build it', { agentModel: paidModel });
            expect(sentOptions?.resolvedAgentId).to.equal('codex');
            expect(gatedAgent).to.equal(paidModel.vendor);
        });

        it('blocks the send when a picker agent has no chosen model (fail closed)', async () => {
            const { ui, innerCalls } = uiWithInner();
            ui['routeSubmitAgent'] = async (): Promise<string> => 'grok';
            let gated = 0;
            ui['confirmPaidSend'] = async (): Promise<boolean> => {
                gated++;
                return true;
            };
            // No stored model and no catalog reachable: nothing can be sent without a choice.
            expect(await ui.submitBackgroundAgentTask(project, 'build it')).to.be.undefined;
            expect(innerCalls).to.be.empty;
            expect(gated).to.equal(0);
        });

        it('does not start a task with a paid model the user declines', async () => {
            const { ui, innerCalls } = uiWithInner();
            ui['confirmPaidSend'] = async (): Promise<boolean> => false;
            expect(await ui.submitBackgroundAgentTask(project, 'build it', { agentModel: paidModel })).to.be.undefined;
            expect(innerCalls).to.be.empty;
        });

        it('starts the task once the paid send is confirmed', async () => {
            const { ui, innerCalls } = uiWithInner();
            ui['confirmPaidSend'] = async (): Promise<boolean> => true;
            await ui.submitBackgroundAgentTask(project, 'build it', { agentModel: paidModel });
            expect(innerCalls).to.have.length(1);
        });

        it('consults the gate for a free model and still starts the task', async () => {
            const { ui, innerCalls } = uiWithInner();
            let asked = 0;
            ui['confirmPaidSend'] = async (): Promise<boolean> => {
                asked++;
                return true;
            };
            await ui.submitBackgroundAgentTask(project, 'build it', { agentModel: freeModel });
            expect(innerCalls).to.have.length(1);
            // The gate is consulted, but the real confirmation passes free models without a dialog.
            expect(asked).to.equal(1);
        });
    });
    describe('stop during new-task creation', () => {
        const project = { id: 'p1', name: 'app' } as unknown as MobileProjectEntry;

        interface StopHarness {
            ui: MobileProjectsBackgroundTaskUi;
            cancelled: string[];
            archived: string[];
            opened: string[];
            seeded: string[];
            rolledBack: number[];
            warnings: string[];
            errors: string[];
        }

        function uiCreating(options: {
            onCreate?: () => void;
            cancel?: () => Promise<void>;
            conversation?: () => Promise<{ messages: Array<{ role: 'user' | 'agent'; content: string; segments?: unknown[]; traceEvents?: unknown[] }> }>;
        } = {}): StopHarness {
            const harness: StopHarness = { ui: undefined as never, cancelled: [], archived: [], opened: [], seeded: [], rolledBack: [], warnings: [], errors: [] };
            const ui = new MobileProjectsBackgroundTaskUi({
                projects: [],
                preparedCwdByProjectId: new Map(),
                justAddedTaskId: undefined,
                agentsHubShellActive: false,
                projectsService: { getProjectCwd: () => '/repo/app' } as never,
                delegate: {},
                transcriptSheetUi: { openTranscriptSheet: async (_p: unknown, summary: { id: string }) => { harness.opened.push(summary.id); } } as never,
                transcriptLiveUi: {} as never,
                shouldUseAgentsHubLanding: () => false,
                renderSubtitle: () => undefined,
                renderList: () => undefined,
                seedTranscriptOptimisticSubmit: (summary: { id: string }) => { harness.seeded.push(summary.id); },
                syncWorkHubProjectSkillRoots: () => undefined,
                rollbackTranscriptOptimisticSubmit: () => { harness.rolledBack.push(1); },
                messageService: {
                    warn: (message: string) => { harness.warnings.push(message); },
                    error: (message: string) => { harness.errors.push(message); },
                } as never,
            });
            ui['confirmPaidSend'] = async (): Promise<boolean> => true;
            // Routing and the model are resolved before the gate: stub routing and store a free pick so no network runs.
            ui['routeSubmitAgent'] = async (): Promise<string> => 'codex';
            writeStoredAgentModel('/repo/app', 'codex', { provider: 'openai', vendor: 'codex', modelId: 'gpt-mini:free' });
            ui['ensureInlineComposerCwd'] = async (): Promise<string> => '/repo/app';
            ui['createProjectChatSession'] = async () => {
                options.onCreate?.();
                return { summary: { id: 'task-new', cwd: '/repo/app' }, outbound: 'build it' } as never;
            };
            ui['requestConversationCancel'] = async (id: string): Promise<void> => {
                harness.cancelled.push(id);
                await options.cancel?.();
            };
            ui['loadConversation'] = async () => (options.conversation
                ? options.conversation()
                : { messages: [{ role: 'user', content: 'build it' }] }) as never;
            ui['archiveConversation'] = async (id: string): Promise<void> => { harness.archived.push(id); };
            harness.ui = ui;
            return harness;
        }

        const stop = (): void => { requestStopNewTaskStartup('p1'); };

        it('archives a stopped task that produced no output, restores the draft and reports none', async () => {
            const h = uiCreating({ onCreate: stop });
            expect(await h.ui.submitBackgroundAgentTask(project, 'build it', {})).to.be.undefined;
            expect(h.cancelled).to.deep.equal(['task-new']);
            expect(h.archived).to.deep.equal(['task-new']);
            expect(h.rolledBack).to.have.length(1);
            expect(h.warnings).to.have.length(1);
            expect(h.opened).to.be.empty;
            expect(h.seeded).to.be.empty;
        });

        it('keeps a stopped task that produced agent output open as stopped and never restores', async () => {
            const h = uiCreating({
                onCreate: stop,
                conversation: async () => ({ messages: [
                    { role: 'user', content: 'build it' },
                    { role: 'agent', content: '', segments: [{ kind: 'tool' }] },
                ] }),
            });
            const result = await h.ui.submitBackgroundAgentTask(project, 'build it', {});
            expect(result?.id).to.equal('task-new');
            expect(h.archived).to.be.empty;
            expect(h.opened).to.deep.equal(['task-new']);
            expect(h.rolledBack).to.be.empty;
            expect(h.warnings).to.be.empty;
        });

        it('keeps the task open and reports the error when the cancel does not reach the server', async () => {
            const h = uiCreating({ onCreate: stop, cancel: async () => { throw new Error('network down'); } });
            const result = await h.ui.submitBackgroundAgentTask(project, 'build it', {});
            expect(result?.id).to.equal('task-new');
            expect(h.errors).to.have.length(1);
            expect(h.opened).to.deep.equal(['task-new']);
            expect(h.archived).to.be.empty;
            expect(h.rolledBack).to.be.empty;
            expect(h.warnings).to.be.empty;
        });

        it('keeps the task when its state cannot be read after the cancel (never restores blindly)', async () => {
            const h = uiCreating({ onCreate: stop, conversation: async () => { throw new Error('unreachable'); } });
            const result = await h.ui.submitBackgroundAgentTask(project, 'build it', {});
            expect(result?.id).to.equal('task-new');
            expect(h.archived).to.be.empty;
            expect(h.opened).to.deep.equal(['task-new']);
            expect(h.rolledBack).to.be.empty;
        });

        it('ignores a second submit for the same project while the first is still being confirmed', async () => {
            const h = uiCreating();
            let confirmations = 0;
            let release: (value: boolean) => void = () => undefined;
            h.ui['confirmPaidSend'] = (): Promise<boolean> => {
                confirmations++;
                return new Promise<boolean>(resolve => { release = resolve; });
            };
            const first = h.ui.submitBackgroundAgentTask(project, 'first', { openConversation: false });
            // Let the first submit reach the payment gate (routing and model resolution come first).
            await new Promise(resolve => setTimeout(resolve, 0));
            const second = await h.ui.submitBackgroundAgentTask(project, 'second', { openConversation: false });
            expect(second).to.be.undefined;
            expect(confirmations).to.equal(1);
            release(true);
            expect((await first)?.id).to.equal('task-new');
            // The first creation has ended: no startup is left in flight for the project.
            expect(requestStopNewTaskStartup('p1')).to.equal(false);
        });

        it('starts the task normally when nothing was stopped', async () => {
            const h = uiCreating();
            const created = await h.ui.submitBackgroundAgentTask(project, 'build it', { openConversation: false });
            expect(created?.id).to.equal('task-new');
            expect(h.cancelled).to.be.empty;
            expect(h.archived).to.be.empty;
        });
    });
});
