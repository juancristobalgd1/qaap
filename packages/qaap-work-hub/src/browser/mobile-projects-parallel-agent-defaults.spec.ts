// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTaskAgentOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { QaapParallelAgentDefaults } from './mobile-projects-parallel-agent-defaults';

describe('QaapParallelAgentDefaults', () => {
    // Mirrors the reported workspace: Codex probed as logged out, Claude Code unprobed, OpenCode usable.
    const agents: QaapAgentTaskAgentOption[] = [
        { id: 'claude', label: 'Claude Code', available: true, connectionState: 'unknown' },
        { id: 'codex', label: 'Codex', available: false, connectionState: 'disconnected' },
        { id: 'opencode', label: 'OpenCode', available: true, connectionState: 'unknown' },
        { id: 'qaiq', label: 'QAIQ', available: true, connectionState: 'not-required' },
    ];

    it('classifies availability from available + connectionState', () => {
        expect(QaapParallelAgentDefaults.availability(agents[1])).to.equal('not-connected');
        expect(QaapParallelAgentDefaults.availability({ available: true, connectionState: 'disconnected' })).to.equal('not-connected');
        expect(QaapParallelAgentDefaults.availability(agents[3])).to.equal('ready');
        expect(QaapParallelAgentDefaults.availability({ available: true, connectionState: 'connected' })).to.equal('ready');
        expect(QaapParallelAgentDefaults.availability(agents[0])).to.equal('unverified');
        expect(QaapParallelAgentDefaults.availability({ available: true })).to.equal('unverified');
    });

    it('defaults only to connected agents, even when the preferred agent is disconnected', () => {
        const picked = QaapParallelAgentDefaults.pickDefaultAgentIds(agents, ['codex']);
        expect(picked).to.not.include('codex');
        expect(picked).to.deep.equal(['qaiq']);
    });

    it('does not default to an installed agent until its connection is confirmed', () => {
        expect(QaapParallelAgentDefaults.pickDefaultAgentIds(agents, ['OpenCode'])).to.deep.equal(['qaiq']);
        expect(QaapParallelAgentDefaults.pickDefaultAgentIds(agents, [undefined, ''])).to.deep.equal(['qaiq']);
    });

    it('returns no default for an installed but unverified agent', () => {
        const onlyOne: QaapAgentTaskAgentOption[] = [
            { id: 'codex', label: 'Codex', available: false, connectionState: 'disconnected' },
            { id: 'opencode', label: 'OpenCode', available: true },
        ];
        expect(QaapParallelAgentDefaults.pickDefaultAgentIds(onlyOne, ['opencode'])).to.deep.equal([]);
        expect(QaapParallelAgentDefaults.launchableSelection(onlyOne, ['opencode'])).to.deep.equal([]);
    });

    it('returns no defaults when nothing is connected', () => {
        expect(QaapParallelAgentDefaults.pickDefaultAgentIds([agents[1]], ['codex'])).to.deep.equal([]);
    });

    it('drops disconnected, unverified, and unknown ids from a selection before launch', () => {
        expect(QaapParallelAgentDefaults.launchableSelection(agents, ['codex', 'opencode', 'ghost', 'qaiq']))
            .to.deep.equal(['qaiq']);
    });
});
