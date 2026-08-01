// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapAgentConversation, QaapAgentConversationEvent } from '../common/qaap-agent-conversation';
import type { QaapAgentTask, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import type { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';

class VisualEvidenceStoreHarness extends QaapAgentConversationStore {
    readonly createdTasks: { task: QaapAgentTask; request: QaapCreateAgentTaskRequest }[] = [];

    constructor(protected readonly evidenceRoot: string) {
        super();
        const fakeTaskRunner = {
            normalizeAgentId: (id: string): string | undefined => id.trim() || undefined,
            defaultAgent: (): string => 'qaiq',
            listAgents: (): readonly { id: string }[] => [],
            create: (request: QaapCreateAgentTaskRequest): QaapAgentTask => {
                const task: QaapAgentTask = {
                    id: `task-${this.createdTasks.length + 1}`,
                    title: request.title ?? 'Visual repair',
                    command: request.command ?? request.prompt ?? '',
                    cwd: request.cwd,
                    agentId: request.agent,
                    state: 'queued',
                    createdAt: Date.now(),
                };
                this.createdTasks.push({ task, request });
                return task;
            },
            list: (): readonly QaapAgentTask[] => this.createdTasks.map(entry => entry.task),
            cancel: (taskId: string): QaapAgentTask | undefined => {
                const index = this.createdTasks.findIndex(entry => entry.task.id === taskId);
                if (index < 0) {
                    return undefined;
                }
                const current = this.createdTasks[index];
                const task: QaapAgentTask = { ...current.task, state: 'cancelled', finishedAt: Date.now() };
                this.createdTasks[index] = { ...current, task };
                return task;
            },
        };
        (this as unknown as { taskRunner: QaapAgentTaskRunner }).taskRunner = fakeTaskRunner as unknown as QaapAgentTaskRunner;
    }

    seed(conversation: QaapAgentConversation): void {
        this.conversations.set(conversation.id, conversation);
    }

    setStatus(conversationId: string, status: QaapAgentConversation['status']): void {
        const current = this.conversations.get(conversationId);
        if (current) {
            this.conversations.set(conversationId, { ...current, status });
        }
    }

    protected override visualEvidenceDirectory(conversationId: string): string {
        return path.join(this.evidenceRoot, conversationId);
    }

    sweepNow(conversationId: string): Promise<void> {
        return this.sweepUnreferencedVisualEvidence(conversationId);
    }

    settleLatestRepair(content = 'Applied the visual repair.\n[QAAP capture]'): string {
        const conv = this.conversations.get('conversation-1')!;
        const repairUser = [...conv.messages].reverse().find(message =>
            message.role === 'user' && message.visualRepairAttempt !== undefined
        )!;
        const agentId = `agent-repair-${repairUser.visualRepairAttempt}`;
        this.conversations.set(conv.id, {
            ...conv,
            status: 'idle',
            updatedAt: Date.now(),
            messages: [
                ...conv.messages,
                {
                    id: agentId,
                    role: 'agent',
                    content,
                    createdAt: Date.now(),
                    runUserMessageId: repairUser.id,
                },
            ],
        });
        return agentId;
    }

    protected override async persist(): Promise<void> { }

    protected override fire(_event: QaapAgentConversationEvent): void { }
}

describe('QaapAgentConversationStore visual verification', () => {
    let root: string;
    let store: VisualEvidenceStoreHarness;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-visual-evidence-'));
        store = new VisualEvidenceStoreHarness(root);
        store.seed({
            id: 'conversation-1',
            cwd: '/tmp/project',
            agentId: 'qaiq',
            title: 'UI task',
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
            messages: [
                { id: 'user-1', role: 'user', content: 'Improve the UI', createdAt: 1 },
                {
                    id: 'agent-1',
                    role: 'agent',
                    content: 'Implemented the UI.',
                    createdAt: 2,
                    segments: [
                        { type: 'tool', toolUseId: 'edit-1', name: 'Edit', args: '{}', finished: true },
                        { type: 'text', content: 'Implemented the UI.' },
                    ],
                },
            ],
        });
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('stores a private PNG and attaches persistent markdown evidence once', async () => {
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
        const first = await store.recordVisualVerification('conversation-1', {
            status: 'passed',
            summary: 'Preview passed.',
            issues: [],
        }, png);
        const content = first?.messages.at(-1)?.content ?? '';
        const evidenceId = /visual-verifications\/([a-f\d-]{36})/.exec(content)?.[1];
        expect(content).to.contain('[QAAP visual verification]');
        const evidenceSegment = first?.messages.at(-1)?.segments?.at(-1);
        expect(evidenceSegment?.type).to.equal('text');
        expect(evidenceSegment?.type === 'text' ? evidenceSegment.content : '').to.contain('[QAAP visual verification]');
        expect(evidenceId).to.be.a('string');
        expect(store.readVisualVerification('conversation-1', evidenceId!)).to.deep.equal(png);

        const second = await store.recordVisualVerification('conversation-1', {
            status: 'warning',
            summary: 'Duplicate capture.',
            issues: ['duplicate'],
        }, png);
        expect(second?.messages.at(-1)?.content.match(/\[QAAP visual verification\]/g)).to.have.length(1);
        expect(fs.readdirSync(path.join(root, 'conversation-1'))).to.have.length(1);
    });

    it('does not expose evidence across conversation ids', async () => {
        expect(store.readVisualVerification('another-conversation', '00000000-0000-0000-0000-000000000000'))
            .to.equal(undefined);
    });

    it('stores only one screenshot when multiple frontend tabs report concurrently', async () => {
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 4, 5, 6]);
        await Promise.all([
            store.recordVisualVerification('conversation-1', { status: 'passed', summary: 'First.', issues: [] }, png),
            store.recordVisualVerification('conversation-1', { status: 'warning', summary: 'Second.', issues: ['late'] }, png),
        ]);
        expect(fs.readdirSync(path.join(root, 'conversation-1'))).to.have.length(1);
    });

    it('rejects evidence before the backend task reaches idle', async () => {
        store.setStatus('conversation-1', 'settled');
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(await store.recordVisualVerification(
            'conversation-1',
            { status: 'passed', summary: 'Too early.', issues: [] },
            png,
        )).to.equal(undefined);
        expect(fs.existsSync(path.join(root, 'conversation-1'))).to.equal(false);
    });

    it('accepts message-targeted evidence although a newer turn is already streaming', async () => {
        // Auto-continue or a follow-up user message flips the status back to streaming while the
        // dev server is still booting — a targeted capture for the settled reply must still land.
        store.setStatus('conversation-1', 'streaming');
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 7]);
        const conv = await store.recordVisualVerification(
            'conversation-1',
            { status: 'passed', summary: 'Late but targeted.', issues: [] },
            png,
            'agent-1',
        );
        expect(conv?.messages.at(-1)?.content).to.contain('[QAAP visual verification]');
    });

    it('drops targeted evidence when the target is no longer the newest reply', async () => {
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 8]);
        expect(await store.recordVisualVerification(
            'conversation-1',
            { status: 'passed', summary: 'Stale target.', issues: [] },
            png,
            'agent-0',
        )).to.equal(undefined);
        expect(fs.existsSync(path.join(root, 'conversation-1'))).to.equal(false);
    });

    it('treats missing PNG/video evidence as failed validation and exhausts through the same repair loop', async () => {
        const failed = await store.recordVisualVerificationFailure(
            'conversation-1',
            'Automatic capture failed: the preview canvas did not produce a PNG.',
            'agent-1',
        );
        const firstEvidence = failed?.messages.find(message => message.id === 'agent-1')?.content ?? '';
        expect(firstEvidence).to.contain('[QAAP visual verification]');
        expect(firstEvidence).to.contain('[QAAP repair required]');
        expect(firstEvidence).to.contain('Screenshot unavailable');
        expect(firstEvidence).to.contain('did not produce a PNG');
        expect(failed?.messages.at(-1)?.visualRepairAttempt).to.equal(1);

        const firstRepairAgent = store.settleLatestRepair();
        const second = await store.recordVisualVerificationFailure(
            'conversation-1',
            'The headless browser still could not produce evidence.',
            firstRepairAgent,
        );
        expect(second?.messages.at(-1)?.visualRepairAttempt).to.equal(2);

        const secondRepairAgent = store.settleLatestRepair();
        const exhausted = await store.recordVisualVerificationFailure(
            'conversation-1',
            'The headless browser could not produce evidence after the second repair.',
            secondRepairAgent,
        );
        expect(exhausted?.status).to.equal('failed');
        expect(exhausted?.messages.at(-1)?.error).to.contain('2 automatic repair attempts');
        expect(store.createdTasks).to.have.length(2);
    });

    it('attaches a walked flow with one image per captured route', async () => {
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 10]);
        const home = await store.saveVisualEvidenceImage('conversation-1', png);
        const checkout = await store.saveVisualEvidenceImage('conversation-1', png);
        expect(home).to.be.a('string');
        expect(checkout).to.be.a('string');

        const conv = await store.recordVisualVerificationFlow('conversation-1', [
            { label: '/', evidenceId: home!, result: { status: 'passed', summary: 'Home ok.', issues: [] } },
            { label: '/checkout', evidenceId: checkout!, result: { status: 'warning', summary: '1 finding.', issues: ['overflow'] } },
        ], 'agent-1');
        const content = conv?.messages.at(-1)?.content ?? '';
        expect(content).to.contain('[QAAP visual verification]');
        expect(content).to.contain('Walked 2 pages of the app flow.');
        expect(content).to.contain(`visual-verifications/${home}`);
        expect(content).to.contain(`visual-verifications/${checkout}`);
        expect(content).to.contain('`/checkout`');
        expect(store.readVisualVerification('conversation-1', home!)).to.deep.equal(png);
    });

    it('rejects a flow that references an unknown evidence image', async () => {
        expect(await store.recordVisualVerificationFlow('conversation-1', [
            { label: '/', evidenceId: '00000000-0000-0000-0000-000000000000', result: { status: 'passed', summary: 'x', issues: [] } },
        ], 'agent-1')).to.equal(undefined);
    });

    it('stores a recorded tour and attaches the video block', async () => {
        const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-video-src-'));
        const sourcePath = path.join(sourceDir, 'tour.webm');
        fs.writeFileSync(sourcePath, Buffer.from('webm-bytes'));
        const evidenceId = await store.saveVisualEvidenceVideo('conversation-1', sourcePath);
        expect(evidenceId).to.be.a('string');
        expect(fs.existsSync(sourcePath)).to.equal(false);

        const resolved = store.resolveVisualVerificationFile('conversation-1', `${evidenceId}.webm`);
        expect(resolved?.contentType).to.equal('video/webm');
        expect(store.resolveVisualVerificationFile('conversation-1', `${evidenceId}/../escape.webm`)).to.equal(undefined);

        const conv = await store.recordVisualVerificationVideo('conversation-1', evidenceId!, [
            { label: '/', result: { status: 'passed', summary: 'ok', issues: [] } },
        ], 'agent-1');
        const content = conv?.messages.at(-1)?.content ?? '';
        expect(content).to.contain('[QAAP visual verification]');
        expect(content).to.contain('Recorded a video tour of 1 page.');
        expect(content).to.contain(`visual-verifications/${evidenceId}.webm`);
        fs.rmSync(sourceDir, { recursive: true, force: true });
    });

    it('re-enters the same agent and workspace after a failed render, then accepts real visual success', async () => {
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 12]);
        const failed = await store.recordVisualVerification('conversation-1', {
            status: 'failed',
            readiness: 'failed',
            summary: 'The page rendered blank.',
            issues: ['The page has no visible content.'],
        }, png, 'agent-1');

        expect(failed?.status).to.equal('streaming');
        const repair = failed?.messages.at(-1);
        expect(repair?.role).to.equal('user');
        expect(repair?.visualRepairAttempt).to.equal(1);
        expect(repair?.visualRepairSourceAgentMessageId).to.equal('agent-1');
        expect(repair?.content).to.contain('HTTP response alone is not visual success');
        expect(repair?.content).to.contain('[QAAP capture]');
        expect(store.createdTasks).to.have.length(1);
        expect(store.createdTasks[0].request).to.include({ cwd: '/tmp/project', agent: 'qaiq' });

        const repairedAgentId = store.settleLatestRepair();
        const passed = await store.recordVisualVerification('conversation-1', {
            status: 'passed',
            readiness: 'render_ready',
            summary: 'The repaired page rendered correctly.',
            issues: [],
        }, png, repairedAgentId);

        expect(passed?.status).to.equal('idle');
        expect(passed?.messages.at(-1)?.content).to.contain('The repaired page rendered correctly.');
        expect(passed?.messages.at(-1)?.content).to.not.contain('[QAAP repair required]');
        expect(store.createdTasks).to.have.length(1);
    });

    it('deduplicates concurrent failed evidence reports into one repair task', async () => {
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 14]);
        await Promise.all([
            store.recordVisualVerification('conversation-1', {
                status: 'failed', readiness: 'failed', summary: 'Blank.', issues: ['blank'],
            }, png, 'agent-1'),
            store.recordVisualVerification('conversation-1', {
                status: 'failed', readiness: 'failed', summary: 'Blank duplicate.', issues: ['blank'],
            }, png, 'agent-1'),
        ]);
        const conv = store.get('conversation-1');
        expect(store.createdTasks).to.have.length(1);
        expect(conv?.messages.filter(message => message.visualRepairSourceAgentMessageId === 'agent-1')).to.have.length(1);
        expect(fs.readdirSync(path.join(root, 'conversation-1'))).to.have.length(1);
    });

    it('routes a cancelled visual repair through the normal task cancellation path', async () => {
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 15]);
        const repairing = await store.recordVisualVerification('conversation-1', {
            status: 'failed', readiness: 'failed', summary: 'Blank.', issues: ['blank'],
        }, png, 'agent-1');
        const repairUser = repairing?.messages.at(-1);
        expect(repairUser?.visualRepairAttempt).to.equal(1);

        const cancelled = store.cancelRun('conversation-1', repairUser!.id);
        expect(cancelled?.status).to.equal('idle');
        expect(store.createdTasks[0].task.state).to.equal('cancelled');
        expect(store.createdTasks).to.have.length(1);
    });

    it('fails closed after two durable visual repair attempts and never spawns a third', async () => {
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 13]);
        await store.recordVisualVerification('conversation-1', {
            status: 'failed', readiness: 'failed', summary: 'Blank render 1.', issues: ['blank'],
        }, png, 'agent-1');
        const firstRepairAgent = store.settleLatestRepair();
        const afterFirstRepair = await store.recordVisualVerification('conversation-1', {
            status: 'failed', readiness: 'failed', summary: 'Blank render 2.', issues: ['still blank'],
        }, png, firstRepairAgent);
        expect(afterFirstRepair?.messages.at(-1)?.visualRepairAttempt).to.equal(2);
        expect(store.createdTasks).to.have.length(2);

        const secondRepairAgent = store.settleLatestRepair();
        const exhausted = await store.recordVisualVerification('conversation-1', {
            status: 'failed', readiness: 'failed', summary: 'Blank render 3.', issues: ['still blank'],
        }, png, secondRepairAgent);
        expect(exhausted?.status).to.equal('failed');
        expect(exhausted?.messages.at(-1)?.error).to.contain('2 automatic repair attempts');
        expect(exhausted?.messages.at(-1)?.content).to.contain('[QAAP repair required]');
        expect(store.createdTasks).to.have.length(2);

        await store.recordVisualVerification('conversation-1', {
            status: 'failed', readiness: 'failed', summary: 'Duplicate.', issues: ['duplicate'],
        }, png, secondRepairAgent);
        expect(store.createdTasks).to.have.length(2);
    });

    it('sweeps stale unreferenced images but keeps referenced and fresh ones', async () => {
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 11]);
        const kept = await store.saveVisualEvidenceImage('conversation-1', png);
        const staleOrphan = await store.saveVisualEvidenceImage('conversation-1', png);
        const freshOrphan = await store.saveVisualEvidenceImage('conversation-1', png);
        await store.recordVisualVerificationFlow('conversation-1', [
            { label: '/', evidenceId: kept!, result: { status: 'passed', summary: 'ok', issues: [] } },
        ], 'agent-1');
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        fs.utimesSync(path.join(root, 'conversation-1', `${staleOrphan}.png`), twoHoursAgo, twoHoursAgo);
        await store.sweepNow('conversation-1');
        const remaining = fs.readdirSync(path.join(root, 'conversation-1'));
        expect(remaining).to.contain(`${kept}.png`);
        expect(remaining).to.contain(`${freshOrphan}.png`);
        expect(remaining).to.not.contain(`${staleOrphan}.png`);
    });
});
