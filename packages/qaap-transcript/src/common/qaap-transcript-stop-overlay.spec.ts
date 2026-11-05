// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { overlayPendingStopOnConversation } from './qaap-transcript-stop-overlay';

function streaming(): QaapAgentConversationDTO {
    return {
        id: 'c1',
        cwd: '/tmp/project',
        agentId: 'claude',
        title: 'Session',
        status: 'streaming',
        createdAt: 1,
        updatedAt: 2,
        messages: [
            { id: 'user-1', role: 'user', content: 'hola', createdAt: 1 },
            { id: 'agent-1', role: 'agent', content: 'parcial', createdAt: 2, runActive: true },
        ],
    };
}

describe('overlayPendingStopOnConversation', () => {

    it('holds a stale streaming answer at idle with the stopped run marked as cancelled', () => {
        const overlaid = overlayPendingStopOnConversation(streaming());

        expect(overlaid.status).to.equal('idle');
        expect(overlaid.messages[1].runActive).to.equal(undefined);
        expect(JSON.stringify(overlaid.messages[1])).to.contain('run_cancelled');
    });

    it('is idempotent: overlaying twice keeps one cancel marker', () => {
        const once = overlayPendingStopOnConversation(streaming());
        const twice = overlayPendingStopOnConversation(once);

        expect(twice).to.deep.equal(once);
    });

    it('returns an idle conversation unchanged', () => {
        const idle: QaapAgentConversationDTO = { ...streaming(), status: 'idle' };

        expect(overlayPendingStopOnConversation(idle)).to.equal(idle);
    });
});
