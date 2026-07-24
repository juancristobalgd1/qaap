// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    DEFAULT_QAAP_WORKFLOW_ROUTING_TABLE,
    QaapWorkflowRoutingPolicy,
    parseQaapWorkflowRoutingTable,
} from './qaap-workflow-routing';

const all = (): boolean => true;
const none = (): boolean => false;
const only = (...ids: string[]) => (ref: string): boolean => ids.includes(ref);

describe('QaapWorkflowRoutingPolicy', () => {
    const policy = new QaapWorkflowRoutingPolicy();

    it('honours a pinned agentRef without consulting the table', () => {
        const result = policy.resolve('implement', 'cheap', none, 'my-agent');
        expect(result).to.deep.equal({ agentRef: 'my-agent', reason: 'pinned' });
    });

    it('prefers the tier-specific list before the capability default', () => {
        const result = policy.resolve('implement', 'premium', all);
        expect(result).to.deep.equal({ agentRef: 'codex', reason: 'routed' });
    });

    it('skips uninstalled agents and picks the first available one', () => {
        const result = policy.resolve('implement', 'premium', only('claude'));
        expect(result).to.deep.equal({ agentRef: 'claude', reason: 'routed' });
    });

    it('falls back to the capability-wide list when the tier yields nothing available', () => {
        // premium = [codex, claude]; any = [qaiq]. Only qaiq installed → routes via `any`.
        const result = policy.resolve('implement', 'premium', only('qaiq'));
        expect(result).to.deep.equal({ agentRef: 'qaiq', reason: 'routed' });
    });

    it('returns an undefined ref (runner default) when no known backend is installed', () => {
        const result = policy.resolve('judge', 'standard', none);
        expect(result).to.deep.equal({ agentRef: undefined, reason: 'fallback' });
    });

    it('treats an unknown capability as a fallback rather than throwing', () => {
        const empty = new QaapWorkflowRoutingPolicy({});
        expect(empty.resolve('implement', 'cheap', all).reason).to.equal('fallback');
    });
});

describe('parseQaapWorkflowRoutingTable', () => {
    it('returns the default table for empty or missing config', () => {
        expect(parseQaapWorkflowRoutingTable(undefined)).to.equal(DEFAULT_QAAP_WORKFLOW_ROUTING_TABLE);
        expect(parseQaapWorkflowRoutingTable('   ')).to.equal(DEFAULT_QAAP_WORKFLOW_ROUTING_TABLE);
    });

    it('parses a custom table and routes through it', () => {
        const table = parseQaapWorkflowRoutingTable('{"implement":{"cheap":["pi"],"any":["hermes"]}}');
        const policy = new QaapWorkflowRoutingPolicy(table);
        expect(policy.resolve('implement', 'cheap', only('pi')).agentRef).to.equal('pi');
        expect(policy.resolve('implement', 'standard', only('hermes')).agentRef).to.equal('hermes');
    });

    it('drops non-string ids and empty routes without failing', () => {
        const table = parseQaapWorkflowRoutingTable('{"implement":{"any":[1,"pi",""]},"judge":{"any":[]}}');
        expect(table.implement?.any).to.deep.equal(['pi']);
        expect(table.judge).to.equal(undefined);
    });

    it('falls back to the default on malformed JSON', () => {
        expect(parseQaapWorkflowRoutingTable('{not json')).to.equal(DEFAULT_QAAP_WORKFLOW_ROUTING_TABLE);
    });
});
