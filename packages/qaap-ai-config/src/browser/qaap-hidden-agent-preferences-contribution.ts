// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceSchemaService } from '@theia/core/lib/common/preferences/preference-schema';

/**
 * Hides Settings entries tied to upstream Theia agents that the Qaap cloud product no longer ships
 * (see {@link QaapUnshippedAgentsContribution}). The agents are unregistered at runtime, but their
 * upstream `PreferenceContribution` schemas still register, leaving dangling settings in
 * AI Configuration / Settings — e.g. `ai-features.agentMode.enabled`, whose description reads
 * "Enable agent mode for the Coder agent".
 *
 * We mark those properties `hidden`, which the preference editor omits (see
 * `preference-tree-generator.ts`). Drift-safe: the upstream schema is never edited and the
 * preference stays functional for any code that still reads it; only the editor entry is removed.
 *
 * Done at `onStart` (after the upstream schemas have registered) and re-applied on every
 * `onDidChangeSchema`, so a late/re-registered property is still hidden. The `!hidden` guard makes
 * the re-apply a no-op once hidden, avoiding an event loop.
 */
@injectable()
export class QaapHiddenAgentPreferencesContribution implements FrontendApplicationContribution {

    @inject(PreferenceSchemaService)
    protected readonly schemaService: PreferenceSchemaService;

    /**
     * Preference ids whose owning agent is no longer shipped. They are hidden from the editor, and
     * their description is rewritten to drop the stale agent name (the upstream text mentions the
     * "Coder agent"). The description override is belt-and-suspenders: even where a custom editor
     * does not honour `hidden`, the entry no longer references a removed agent.
     */
    protected readonly unshippedPreferenceOverrides: ReadonlyArray<{ id: string; description: string }> = [
        {
            id: 'ai-features.agentMode.enabled', // upstream: "Enable agent mode for the Coder agent"
            description: 'Enable agent mode, allowing autonomous file modifications without further confirmation.'
                + ' A first-use confirmation dialog is shown until this is set to `true`.'
        }
    ];

    onStart(): void {
        this.hideUnshippedAgentPreferences();
        this.schemaService.onDidChangeSchema(() => this.hideUnshippedAgentPreferences());
    }

    protected hideUnshippedAgentPreferences(): void {
        for (const override of this.unshippedPreferenceOverrides) {
            const property = this.schemaService.getSchemaProperty(override.id);
            if (property && (!property.hidden || property.description !== override.description)) {
                this.schemaService.updateSchemaProperty(override.id, {
                    hidden: true,
                    description: override.description
                });
            }
        }
    }
}
