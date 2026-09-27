// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    computeSummaryChangedFields,
    isPreviewOnlyConversationChange,
    isPreviewOnlySummaryChange,
} from './qaap-conversation-change';
import type { QaapAgentConversationSummaryDTO } from './qaap-agent-conversation-client';

describe('qaap-conversation-change', () => {
    const base: QaapAgentConversationSummaryDTO = {
        id: 'c1',
        cwd: '/repo',
        agentId: 'qaiq',
        title: 'Task',
        status: 'streaming',
        createdAt: 1,
        updatedAt: 1,
        messageCount: 2,
        lastMessagePreview: 'Working',
        turnProgressCurrent: 1,
    };

    it('flags structural changes as non-preview-only', () => {
        const fields = computeSummaryChangedFields(base, { ...base, status: 'idle' });
        expect(fields).to.include('status');
        expect(isPreviewOnlySummaryChange(fields)).to.equal(false);
    });

    it('isPreviewOnlyConversationChange detects preview-only message_delta events', () => {
        expect(isPreviewOnlyConversationChange({
            kind: 'message_delta',
            conversationId: 'c1',
            cwd: '/repo',
            changedFields: ['lastMessagePreview', 'updatedAt'],
            listOrderChanged: false,
        })).to.equal(true);
        expect(isPreviewOnlyConversationChange({
            kind: 'message_delta',
            conversationId: 'c1',
            cwd: '/repo',
            changedFields: ['status'],
            listOrderChanged: false,
        })).to.equal(false);
        expect(isPreviewOnlyConversationChange({
            kind: 'document_loaded',
            conversationId: 'c1',
            cwd: '/repo',
        })).to.equal(false);
    });
});
