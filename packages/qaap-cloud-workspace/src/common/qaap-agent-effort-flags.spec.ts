// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { formatEffortFlagsForAgent } from './qaap-agent-effort-flags';

describe('qaap-agent-effort-flags', () => {
    it('emits the native effort flag for each supported harness', () => {
        expect(formatEffortFlagsForAgent('claude', undefined, 'max')).to.equal('--effort max');
        expect(formatEffortFlagsForAgent('codex', 'gpt-5.6-sol', 'high')).to.equal('-c model_reasoning_effort=high');
        expect(formatEffortFlagsForAgent('opencode', 'opencode/paid-model', 'max')).to.equal('--variant max');
        expect(formatEffortFlagsForAgent('pi', undefined, 'off')).to.equal('--thinking off');
    });

    it('emits nothing for a level the harness does not support', () => {
        expect(formatEffortFlagsForAgent('codex', undefined, 'max')).to.equal('');
        expect(formatEffortFlagsForAgent('claude', undefined, 'minimal')).to.equal('');
    });

    it('emits nothing for a harness without effort, a free OpenCode model, or no level', () => {
        expect(formatEffortFlagsForAgent('grok', undefined, 'high')).to.equal('');
        expect(formatEffortFlagsForAgent('opencode', 'opencode/big-pickle', 'high')).to.equal('');
        expect(formatEffortFlagsForAgent('claude', undefined, undefined)).to.equal('');
    });
});
