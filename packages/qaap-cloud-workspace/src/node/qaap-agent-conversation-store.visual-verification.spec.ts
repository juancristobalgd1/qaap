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

    protected override visualEvidenceDirectory(conversationId: string): string {
        return path.join(this.evidenceRoot, conversationId);
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
                { id: 'agent-1', role: 'agent', content: 'Implemented the UI.', createdAt: 2 },
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
});
