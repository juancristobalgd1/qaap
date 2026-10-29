// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_BUILTIN_AGENT_DEFINITIONS, resolveQaapCodexTemplate } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';

describe('qaap-builtin-agents', () => {

    it('uses codex exec --json for newer Codex CLI help output', () => {
        expect(resolveQaapCodexTemplate('Usage: codex [OPTIONS] [COMMAND]\n\nCommands:\n  exec  Run non-interactively'))
            .to.equal('codex exec --json -c check_for_update_on_startup=false {model_flags} {prompt}');
    });

    it('uses quiet top-level mode with --json for old Codex CLI help output', () => {
        expect(resolveQaapCodexTemplate('Usage\n  $ codex [options] <prompt>\n\nOptions\n  -q, --quiet'))
            .to.equal('codex -q --json -c check_for_update_on_startup=false {model_flags} {prompt}');
    });

    it('registers Pi (and not the retired Hermes) as a built-in agent', () => {
        const pi = QAAP_BUILTIN_AGENT_DEFINITIONS.find(definition => definition.id === 'pi');
        expect(pi?.template).to.equal('pi --mode json -p --no-session -e {gate_ext} {trust_flags} {model_flags} {prompt}');
        expect(QAAP_BUILTIN_AGENT_DEFINITIONS.find(definition => definition.id === 'hermes')).to.equal(undefined);
    });
});
