// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { AGENT_TURN_WARM_MIN_INTERVAL_MS, shouldWarmAgentTurn } from './qaap-agent-turn-warm';

describe('shouldWarmAgentTurn', () => {
    it('allows the first warm-up per cwd and blocks repeats inside the interval', () => {
        const lastWarmAt = new Map<string, number>();
        const start = 1_000_000;
        expect(shouldWarmAgentTurn('/repos/a', start, lastWarmAt)).to.equal(true);
        expect(shouldWarmAgentTurn('/repos/a', start + 1, lastWarmAt)).to.equal(false);
        expect(shouldWarmAgentTurn('/repos/a', start + AGENT_TURN_WARM_MIN_INTERVAL_MS - 1, lastWarmAt)).to.equal(false);
    });

    it('allows another warm-up once the interval has elapsed', () => {
        const lastWarmAt = new Map<string, number>();
        const start = 1_000_000;
        shouldWarmAgentTurn('/repos/a', start, lastWarmAt);
        expect(shouldWarmAgentTurn('/repos/a', start + AGENT_TURN_WARM_MIN_INTERVAL_MS, lastWarmAt)).to.equal(true);
    });

    it('tracks each cwd independently', () => {
        const lastWarmAt = new Map<string, number>();
        expect(shouldWarmAgentTurn('/repos/a', 0, lastWarmAt)).to.equal(true);
        expect(shouldWarmAgentTurn('/repos/b', 0, lastWarmAt)).to.equal(true);
    });
});
