// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildQaapHealthResponse } from './qaap-cloud-api-types';

describe('buildQaapHealthResponse', () => {

    it('ok is true when at least one agent was detected on PATH', () => {
        const health = buildQaapHealthResponse({
            uptimeMs: 42_000,
            agentConfigured: true,
            detectedAgentIds: ['qaiq', 'codex'],
            defaultAgent: 'qaiq',
        });
        expect(health.ok).to.equal(true);
        expect(health.agents).to.deep.equal(['qaiq', 'codex']);
        expect(health.uptimeMs).to.equal(42_000);
        expect(health.defaultAgent).to.equal('qaiq');
    });

    it('ok is false when no agent CLIs were detected', () => {
        const health = buildQaapHealthResponse({
            uptimeMs: 1000,
            agentConfigured: false,
            detectedAgentIds: [],
            defaultAgent: 'shell',
        });
        expect(health.ok).to.equal(false);
        expect(health.agents).to.deep.equal([]);
    });

    it('ok stays false when only QAAP_AGENT_COMMAND is set without a detected bin', () => {
        const health = buildQaapHealthResponse({
            uptimeMs: 2000,
            agentConfigured: true,
            detectedAgentIds: [],
            defaultAgent: 'env',
        });
        expect(health.ok).to.equal(false);
        expect(health.agentConfigured).to.equal(true);
    });
});
