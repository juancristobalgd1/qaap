// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapAgentConversation, QaapAgentConversationEvent } from '../common/qaap-agent-conversation';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';

class VisualEvidenceStoreHarness extends QaapAgentConversationStore {
    constructor(protected readonly evidenceRoot: string) {
        super();
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

    it('settles the evidence slot with a visible failure note that blocks later screenshots', async () => {
        const failed = store.recordVisualVerificationFailure(
            'conversation-1',
            'Automatic capture failed: the preview canvas did not produce a PNG.',
            'agent-1',
        );
        const content = failed?.messages.at(-1)?.content ?? '';
        expect(content).to.contain('[QAAP visual verification]');
        expect(content).to.contain('Screenshot unavailable');
        expect(content).to.contain('did not produce a PNG');

        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9]);
        const afterwards = await store.recordVisualVerification(
            'conversation-1',
            { status: 'passed', summary: 'Too late.', issues: [] },
            png,
            'agent-1',
        );
        expect(afterwards?.messages.at(-1)?.content.match(/\[QAAP visual verification\]/g)).to.have.length(1);
        expect(fs.existsSync(path.join(root, 'conversation-1'))).to.equal(false);
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
