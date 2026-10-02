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

    it('never defaults to a disconnected agent, even when it is the preferred one', () => {
        const picked = QaapParallelAgentDefaults.pickDefaultAgentIds(agents, ['codex']);
        expect(picked).to.not.include('codex');
        expect(picked).to.have.length(2);
    });

    it('puts the currently selected agent first, then backend-confirmed agents', () => {
        expect(QaapParallelAgentDefaults.pickDefaultAgentIds(agents, ['OpenCode'])).to.deep.equal(['opencode', 'qaiq']);
        expect(QaapParallelAgentDefaults.pickDefaultAgentIds(agents, [undefined, ''])).to.deep.equal(['qaiq', 'claude']);
    });

    it('returns a single agent when only one can launch', () => {
        const onlyOne: QaapAgentTaskAgentOption[] = [
            { id: 'codex', label: 'Codex', available: false, connectionState: 'disconnected' },
            { id: 'opencode', label: 'OpenCode', available: true },
        ];
        expect(QaapParallelAgentDefaults.pickDefaultAgentIds(onlyOne, ['codex'])).to.deep.equal(['opencode']);
    });

    it('returns no defaults when nothing is connected', () => {
        expect(QaapParallelAgentDefaults.pickDefaultAgentIds([agents[1]], ['codex'])).to.deep.equal([]);
    });

    it('drops disconnected and unknown ids from a selection before launch', () => {
        expect(QaapParallelAgentDefaults.launchableSelection(agents, ['codex', 'opencode', 'ghost'])).to.deep.equal(['opencode']);
    });
});
