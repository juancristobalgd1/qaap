// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { researchGoalToCreateBody } from './qaap-research-api';
import { normalizeResearchGoal } from './qaap-research-goal';

describe('qaap-research-api', () => {

    it('researchGoalToCreateBody clones a goal config without id/status metadata', () => {
        const goal = normalizeResearchGoal({
            id: 'g1',
            cwd: '/repo/app',
            description: 'Reduce loss',
            metrics: [{ name: 'loss', direction: 'min', metricCommand: 'echo 0.5', primary: true }],
            runCommand: 'npm run train',
            status: 'completed',
            terminationReason: 'reached-target',
        });
        expect(researchGoalToCreateBody(goal)).to.deep.equal({
            cwd: '/repo/app',
            description: 'Reduce loss',
            agentId: undefined,
            agentModel: undefined,
            runCommand: 'npm run train',
            runTimeoutMs: goal.runTimeoutMs,
            metrics: [{ name: 'loss', direction: 'min', metricCommand: 'echo 0.5', metricRegex: undefined, primary: true, minImprovement: 0 }],
            maxRounds: goal.maxRounds,
            deadlineAt: undefined,
            stagnationRounds: goal.stagnationRounds,
            infraFailureLimit: goal.infraFailureLimit,
        });
    });
});
