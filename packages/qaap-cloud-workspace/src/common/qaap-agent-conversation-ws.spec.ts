// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { parseQaapAgentConversationWsClientMessage } from './qaap-agent-conversation-ws';

describe('parseQaapAgentConversationWsClientMessage', () => {
    it('parses cancel frames', () => {
        expect(parseQaapAgentConversationWsClientMessage({
            op: 'cancel',
            conversationId: ' conv-1 ',
        })).to.deep.equal({ op: 'cancel', conversationId: 'conv-1' });
    });

    it('parses ping frames', () => {
        expect(parseQaapAgentConversationWsClientMessage({ op: 'ping' })).to.deep.equal({ op: 'ping' });
    });

    it('parses v2 hello, focus and unfocus frames', () => {
        expect(parseQaapAgentConversationWsClientMessage({ op: 'hello', epoch: 'e1', lastSeq: 7, focus: ['a', ' b ', 3, ''] }))
            .to.deep.equal({ op: 'hello', epoch: 'e1', lastSeq: 7, focus: ['a', 'b'] });
        expect(parseQaapAgentConversationWsClientMessage({ op: 'hello' }))
            .to.deep.equal({ op: 'hello', epoch: undefined, lastSeq: undefined, focus: [] });
        expect(parseQaapAgentConversationWsClientMessage({ op: 'hello', lastSeq: -1 }))
            .to.deep.equal({ op: 'hello', epoch: undefined, lastSeq: undefined, focus: [] });
        expect(parseQaapAgentConversationWsClientMessage({ op: 'focus', id: 't1', sinceSeq: 4, epoch: 'e1' }))
            .to.deep.equal({ op: 'focus', id: 't1', sinceSeq: 4, epoch: 'e1' });
        expect(parseQaapAgentConversationWsClientMessage({ op: 'focus', id: 't1', sinceSeq: 'x' }))
            .to.deep.equal({ op: 'focus', id: 't1', sinceSeq: undefined, epoch: undefined });
        expect(parseQaapAgentConversationWsClientMessage({ op: 'unfocus', id: 't1' })).to.deep.equal({ op: 'unfocus', id: 't1' });
        expect(parseQaapAgentConversationWsClientMessage({ op: 'focus' })).to.equal(undefined);
    });

    it('rejects malformed frames', () => {
        expect(parseQaapAgentConversationWsClientMessage({ op: 'cancel' })).to.equal(undefined);
        expect(parseQaapAgentConversationWsClientMessage(null)).to.equal(undefined);
    });
});
