// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { OPENCODE_MODEL_ACCESS_DISABLED_LIVE_LOG } from '@theia/qaap-shared-core/lib/common/test/qaap-agent-failure-log-fixtures';
import { resolveFailedTurnBody } from './qaap-failed-turn-body';

const GATE_NOTE = '[qaap] OpenCode tool gate unavailable: This OpenCode loaded the Qaap gate plugin but never called tool.execute.before. '
    + 'Gated actions (edits, shell, network) are refused for this run.';

describe('resolveFailedTurnBody', () => {

    it('drops the OpenCode gate note when the provider refused the turn before any tool call', () => {
        const body = resolveFailedTurnBody('opencode', OPENCODE_MODEL_ACCESS_DISABLED_LIVE_LOG, { role: 'agent', content: '' });
        expect(body).not.to.contain('tool gate unavailable');
        expect(body).not.to.contain('tool.execute.before');
        // The provider's own lines stay, for the failure card's details.
        expect(body).to.contain('Model access is disabled');
        expect(body.startsWith('timestamp=')).to.equal(true);
    });

    it('keeps the gate note when the agent did request a tool (the gate may be why the turn failed)', () => {
        const body = resolveFailedTurnBody('opencode', OPENCODE_MODEL_ACCESS_DISABLED_LIVE_LOG, {
            role: 'agent',
            content: '',
            segments: [{ type: 'tool', toolUseId: 't1', name: 'Bash', args: '{"command":"ls"}', finished: true, result: 'refused' }],
        });
        expect(body).to.contain('tool gate unavailable');
    });

    it('keeps the gate note for a failure that is not the provider\'s', () => {
        const log = `${GATE_NOTE}\nSomething odd happened in the plugin\nprocess exited`;
        expect(resolveFailedTurnBody('opencode', log, { role: 'agent', content: '' })).to.contain('tool gate unavailable');
    });

    it('returns an empty body without a log', () => {
        expect(resolveFailedTurnBody('opencode', undefined)).to.equal('');
    });
});
