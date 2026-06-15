// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildAgentTurnPushNotifyRequest, buildQaapWebPushWirePayload } from './qaap-web-push-payload';

describe('qaap-web-push-payload', () => {
    it('prefixes project name in the wire title', () => {
        const wire = buildQaapWebPushWirePayload({
            title: 'Agent finished',
            body: 'qaiq finished.',
            projectName: 'my-app',
            route: 'transcript',
            conversationId: 'c1',
        });
        expect(wire.title).to.equal('[my-app] Agent finished');
        expect(wire.conversationId).to.equal('c1');
    });

    it('builds needs-you approval payload with transcript route', () => {
        const request = buildAgentTurnPushNotifyRequest({
            ok: false,
            title: 'Fix tests',
            conversationId: 'c9',
            agentId: 'qaiq',
            projectName: 'repo',
            needsApproval: true,
        });
        expect(request.tag).to.equal('qaap-needs-you-c9');
        expect(request.route).to.equal('transcript');
        expect(request.needsApproval).to.equal(true);
    });
});
