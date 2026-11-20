// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveHarnessSettingsRows } from './qaap-harness-configuration-state';
import { resolveQaapHarnessDisplayLabel } from '@theia/qaap-shared-core/lib/common/qaap-harness-launch-settings';

describe('resolveHarnessSettingsRows', () => {
    const definitions = [
        { id: 'codex', label: 'Codex', bin: 'codex' },
        { id: 'claude', label: 'Claude Code', bin: 'claude' },
    ];

    it('shows each added harness right after its base harness, with its own name', () => {
        const settings = { codex: { label: 'Codex (personal)' }, 'codex#3': { label: 'Codex (client)' } };
        const rows = resolveHarnessSettingsRows(
            definitions,
            [{ id: 'codex#2', baseId: 'codex' }, { id: 'codex#3', baseId: 'codex' }, { id: 'hermes#2', baseId: 'hermes' }],
            (id, baseLabel) => resolveQaapHarnessDisplayLabel(settings, id, baseLabel),
        );
        expect(rows.map(row => [row.id, row.label, row.isInstance, row.baseId])).to.deep.equal([
            ['codex', 'Codex (personal)', false, 'codex'],
            ['codex#2', 'Codex 2', true, 'codex'],
            ['codex#3', 'Codex (client)', true, 'codex'],
            ['claude', 'Claude Code', false, 'claude'],
        ]);
    });
});
