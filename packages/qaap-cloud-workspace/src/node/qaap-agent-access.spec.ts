// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// ****************************************************************************

import { expect } from 'chai';
import { isHostedCodexEntitled, resolveAgentAccess } from './qaap-agent-access';

describe('resolveAgentAccess', () => {
    it('answers session for a connected agent', () => {
        expect(resolveAgentAccess({ agentId: 'claude', connectionState: 'connected', probeSettled: true, hostedEntitled: false }))
            .to.equal('session');
    });

    it('answers session for an agent that needs no sign-in', () => {
        expect(resolveAgentAccess({ agentId: 'qaiq', connectionState: 'not-required', probeSettled: false, hostedEntitled: false }))
            .to.equal('session');
    });

    it('answers hosted for Codex with hosted entitlement, even when disconnected', () => {
        expect(resolveAgentAccess({ agentId: 'codex', connectionState: 'disconnected', probeSettled: true, hostedEntitled: true }))
            .to.equal('hosted');
        expect(resolveAgentAccess({ agentId: 'CODEX', connectionState: 'unknown', probeSettled: false, hostedEntitled: true }))
            .to.equal('hosted');
    });

    it('does not grant hosted access to other agents', () => {
        expect(resolveAgentAccess({ agentId: 'claude', connectionState: 'disconnected', probeSettled: true, hostedEntitled: true }))
            .to.equal('none');
    });

    it('answers none for a disconnected agent without hosted entitlement', () => {
        expect(resolveAgentAccess({ agentId: 'codex', connectionState: 'disconnected', probeSettled: true, hostedEntitled: false }))
            .to.equal('none');
        expect(resolveAgentAccess({ agentId: 'codex', connectionState: 'disconnected', probeSettled: false, hostedEntitled: false }))
            .to.equal('none');
    });

    it('answers none for an unknown state once its probe has settled', () => {
        expect(resolveAgentAccess({ agentId: 'codex', connectionState: 'unknown', probeSettled: true, hostedEntitled: false }))
            .to.equal('none');
    });

    it('stays unknown while the probe is still pending', () => {
        expect(resolveAgentAccess({ agentId: 'codex', connectionState: 'unknown', probeSettled: false, hostedEntitled: false }))
            .to.equal('unknown');
    });
});

describe('isHostedCodexEntitled', () => {
    it('requires hosted models and credits left', () => {
        expect(isHostedCodexEntitled({ hostedModels: true, creditsRemaining: 1 })).to.equal(true);
        expect(isHostedCodexEntitled({ hostedModels: true, creditsRemaining: 0 })).to.equal(false);
        expect(isHostedCodexEntitled({ hostedModels: false, creditsRemaining: 50 })).to.equal(false);
        expect(isHostedCodexEntitled({ hostedModels: true })).to.equal(false);
        expect(isHostedCodexEntitled(undefined)).to.equal(false);
    });
});
