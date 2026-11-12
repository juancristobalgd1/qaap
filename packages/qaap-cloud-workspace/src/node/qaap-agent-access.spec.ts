// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// ****************************************************************************

import { expect } from 'chai';
import { resolveAgentAccess } from './qaap-agent-access';

describe('resolveAgentAccess', () => {
    it('answers session for a connected agent', () => {
        expect(resolveAgentAccess({ agentId: 'claude', connectionState: 'connected', probeSettled: true }))
            .to.equal('session');
    });

    it('answers session for an agent that needs no sign-in', () => {
        expect(resolveAgentAccess({ agentId: 'qaiq', connectionState: 'not-required', probeSettled: false }))
            .to.equal('session');
    });

    it('answers none for a disconnected Codex: there is no hosted Codex access', () => {
        expect(resolveAgentAccess({ agentId: 'codex', connectionState: 'disconnected', probeSettled: true }))
            .to.equal('none');
        expect(resolveAgentAccess({ agentId: 'codex', connectionState: 'disconnected', probeSettled: false }))
            .to.equal('none');
    });

    it('answers none for a disconnected agent of any id', () => {
        expect(resolveAgentAccess({ agentId: 'claude', connectionState: 'disconnected', probeSettled: true }))
            .to.equal('none');
    });

    it('answers none for an unknown state once its probe has settled', () => {
        expect(resolveAgentAccess({ agentId: 'codex', connectionState: 'unknown', probeSettled: true }))
            .to.equal('none');
    });

    it('stays unknown while the probe is still pending', () => {
        expect(resolveAgentAccess({ agentId: 'codex', connectionState: 'unknown', probeSettled: false }))
            .to.equal('unknown');
    });
});
