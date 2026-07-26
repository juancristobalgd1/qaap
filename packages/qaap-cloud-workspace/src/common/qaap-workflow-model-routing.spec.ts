// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentTaskKind } from './qaap-agent-task';
import { QaapWorkflowCapability, QaapWorkflowCostTier } from './qaap-workflow-ir';
import { describeQaapWorkflowAssignment, resolveQaapWorkflowTaskKind } from './qaap-workflow-model-routing';

describe('resolveQaapWorkflowTaskKind', () => {

    it('routes a cheap costTier to exploration regardless of capability', () => {
        const capabilities: QaapWorkflowCapability[] = ['explore', 'implement', 'judge', 'measure', 'synthesize', 'creative', 'general'];
        for (const capability of capabilities) {
            expect(resolveQaapWorkflowTaskKind(capability, 'cheap'), capability).to.equal('exploration');
        }
    });

    it('routes a premium costTier to implementation regardless of capability', () => {
        const capabilities: QaapWorkflowCapability[] = ['explore', 'implement', 'judge', 'measure', 'synthesize', 'creative', 'general'];
        for (const capability of capabilities) {
            expect(resolveQaapWorkflowTaskKind(capability, 'premium'), capability).to.equal('implementation');
        }
    });

    // costTier === 'standard' or omitted: falls back to the capability table. Mirrors the backend
    // routing table — only a caller asking for 'cheap' gets the cheap answer, so `explore` stays on
    // the operator's default model instead of downgrading itself.
    const capabilityExpectations: readonly [QaapWorkflowCapability, QaapAgentTaskKind][] = [
        ['explore', 'general'],
        ['measure', 'exploration'],
        ['implement', 'implementation'],
        // Never the writer's alias — see resolveQaapWorkflowTaskKind's doc: pinning the judge to
        // `implementation` hands the review to the model that wrote the change.
        ['judge', 'general'],
        ['creative', 'general'],
        ['synthesize', 'general'],
        ['general', 'general'],
    ];

    for (const costTier of [undefined, 'standard'] as (QaapWorkflowCostTier | undefined)[]) {
        describe(`with costTier ${costTier ?? '(omitted)'}`, () => {
            for (const [capability, expected] of capabilityExpectations) {
                it(`maps ${capability} to ${expected}`, () => {
                    expect(resolveQaapWorkflowTaskKind(capability, costTier)).to.equal(expected);
                });
            }
        });
    }
});

describe('describeQaapWorkflowAssignment', () => {
    it('summarizes capability, costTier (defaulted) and resolved taskKind', () => {
        const description = describeQaapWorkflowAssignment({
            kind: 'agent-turn',
            id: 'explore-1',
            capability: 'explore',
            isolation: 'cwd-readonly',
            promptRef: 'explore-structure',
        });
        expect(description).to.equal('explore/standard -> taskKind:general');
    });

    it('reflects an explicit costTier override', () => {
        const description = describeQaapWorkflowAssignment({
            kind: 'agent-turn',
            id: 'judge-1',
            capability: 'judge',
            costTier: 'cheap',
            isolation: 'cwd-readonly',
            promptRef: 'adversarial-review',
        });
        expect(description).to.equal('judge/cheap -> taskKind:exploration');
    });
});
