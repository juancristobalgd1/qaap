// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    canEnforceReadOnlyWorkspace,
    formatReadOnlyFlagsForAgent,
    QAAP_PI_PLAN_MODE_INSTRUCTION,
    resolveAgentReadOnlyEnforcement,
    withPiPlanModeInstruction,
} from './qaap-agent-readonly-workspace';

describe('qaap-agent-readonly-workspace Pi', () => {
    it('enforces read-only for Pi through the tool gate, with no CLI flags to add', () => {
        expect(resolveAgentReadOnlyEnforcement('pi')).to.equal('gate');
        expect(canEnforceReadOnlyWorkspace('pi')).to.equal(true);
        expect(formatReadOnlyFlagsForAgent('pi')).to.equal('');
    });

    it('adds the plan-mode instruction only to a Pi prompt in plan mode', () => {
        expect(withPiPlanModeInstruction('fix it', 'pi', 'plan')).to.equal(`${QAAP_PI_PLAN_MODE_INSTRUCTION}\n\nfix it`);
        expect(withPiPlanModeInstruction('fix it', 'pi', 'agent')).to.equal('fix it');
        expect(withPiPlanModeInstruction('fix it', 'pi', undefined)).to.equal('fix it');
        expect(withPiPlanModeInstruction('fix it', 'codex', 'plan')).to.equal('fix it');
    });

    it('keeps other harnesses on their existing mechanisms', () => {
        expect(resolveAgentReadOnlyEnforcement('codex')).to.equal('sandbox');
        expect(resolveAgentReadOnlyEnforcement('grok')).to.equal('none');
    });
});
