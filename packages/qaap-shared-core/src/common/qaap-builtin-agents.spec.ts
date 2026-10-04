// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_BUILTIN_AGENT_DEFINITIONS, resolveQaapCodexTemplate } from './qaap-builtin-agents';

describe('Qaap built-in agent command templates', () => {
    it('suppresses Codex update checks for detected modern and legacy CLIs', () => {
        expect(resolveQaapCodexTemplate('codex exec [OPTIONS]')).to.contain('-c check_for_update_on_startup=false');
        expect(resolveQaapCodexTemplate('codex -q [OPTIONS]')).to.contain('-c check_for_update_on_startup=false');
        expect(QAAP_BUILTIN_AGENT_DEFINITIONS.find(agent => agent.id === 'codex')?.template)
            .to.contain('-c check_for_update_on_startup=false');
    });

    it('lets Hermes load its persisted MCP server configuration', () => {
        const template = QAAP_BUILTIN_AGENT_DEFINITIONS.find(agent => agent.id === 'hermes')?.template ?? '';
        expect(template).not.to.contain('--ignore-user-config');
        expect(template).to.contain('hermes --yolo --provider nous');
    });
});
