// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { PreferenceDataProperty } from '@theia/core/lib/common/preferences';
import { nls } from '@theia/core/lib/common/nls';
import { PreferenceSchemaService } from '@theia/core/lib/common/preferences/preference-schema';
import { inject, injectable } from '@theia/core/shared/inversify';
import { shouldHideQaapAiFeaturesPreference } from '@theia/qaap-shared-core/lib/common/qaap-ai-features-visibility';

const HOST_MACHINE_FROM = 'on the machine running Theia.';
const HOST_MACHINE_TO = 'on the machine running this application.';

const ENABLE_AI_PREF = 'ai-features.AiEnable.enableAI';
const AGENT_SETTINGS_PREF = 'ai-features.agentSettings';
const LANGUAGE_MODEL_ALIASES_PREF = 'ai-features.languageModelAliases';

const IDE_BRIDGE_PREFIX =
    '**IDE chat bridge only** — Work Hub uses the VPS CLI agents (`@claude` / `@codex`) from the composer. ';

/**
 * Preference markdown rewritten for Work Hub (VPS agents in composer; MCP / skills / aliases here).
 */
const WORK_HUB_PREF_MARKDOWN: Readonly<Record<string, string>> = {
    'ai-features.agentSettings.details':
        'Work Hub agents (`@qaiq`, `@codex`, `@claude`, …) are chosen in the **composer**. '
        + 'Use **AI Features → Agents & runtimes** for agent behavior and runtime availability.',
    'ai-features.promptTemplates.details':
        'Prompt folders apply to **classic IDE chat** agents. '
        + 'Work Hub skills and prompt locations are organized under **AI Features → Tools, skills & prompts**.',
    'ai-features.modelSelection.details':
        'Model aliases (for example `default/code`) drive **QAIQ** routing in Work Hub. '
        + 'Configure them under **AI Features → Model routing & behavior**.',
    [LANGUAGE_MODEL_ALIASES_PREF]:
        'Aliases used by **QAIQ** in Work Hub (and IDE chat agents). '
        + 'Edit them directly in this setting or in `settings.json`, for example:\n'
        + '```\n'
        + '"default/code": {\n'
        + '  "selectedModel": "openrouter/openai/gpt-4.1"\n'
        + '}\n'
        + '```',
};

function isIdeBridgePreference(key: string): boolean {
    return key.startsWith('ai-features.claudeCode.') || key.startsWith('ai-features.codex.');
}

/**
 * Qaap AI Features hygiene + Work Hub copy:
 * - brand host-machine API-key warnings
 * - hide Theia leftovers with no Work Hub equivalent
 * - rewrite guidance placeholders / aliases toward Work Hub surfaces
 * - label Claude/Codex prefs as IDE chat bridges (not Work Hub VPS agents)
 */
@injectable()
export class QaapAiPreferenceBrandingStartup implements FrontendApplicationContribution {

    @inject(PreferenceSchemaService)
    protected readonly schemaService: PreferenceSchemaService;

    onStart(): void {
        for (const [key, property] of this.schemaService.getSchemaProperties()) {
            let next: PreferenceDataProperty = property;
            let changed = false;

            const branded = this.brandHostMachineWarning(next);
            if (branded) {
                next = branded;
                changed = true;
            }

            const workHubMarkdown = WORK_HUB_PREF_MARKDOWN[key];
            if (workHubMarkdown && next.markdownDescription !== workHubMarkdown) {
                next = { ...next, markdownDescription: workHubMarkdown };
                changed = true;
            }

            if (isIdeBridgePreference(key)) {
                const withBridge = this.prefixIdeBridgeWarning(next);
                if (withBridge) {
                    next = withBridge;
                    changed = true;
                }
            }

            if (shouldHideQaapAiFeaturesPreference(key) && !next.hidden) {
                next = { ...next, hidden: true };
                changed = true;
            }

            // The standalone AI Configuration view is no longer a user-facing surface. Keep
            // agent preferences available in the organized AI Features settings tree instead.
            if (key === AGENT_SETTINGS_PREF && next.hidden) {
                next = {
                    ...next,
                    hidden: false,
                    markdownDescription: nls.localize(
                        'qaap/preferences/agentSettings/description',
                        'Configure agent enablement, model requirements, prompt variants, and capability selections under **AI Features → Agents & runtimes**.',
                    ),
                };
                changed = true;
            }

            if (key === ENABLE_AI_PREF) {
                next = { ...next, default: true, hidden: true };
                changed = true;
            }

            if (changed) {
                this.schemaService.updateSchemaProperty(key, next);
            }
        }
    }

    protected brandHostMachineWarning(property: PreferenceDataProperty): PreferenceDataProperty | undefined {
        let next = property;
        let changed = false;
        for (const field of ['markdownDescription', 'description'] as const) {
            const value = next[field];
            if (typeof value === 'string' && value.includes(HOST_MACHINE_FROM)) {
                next = { ...next, [field]: value.replaceAll(HOST_MACHINE_FROM, HOST_MACHINE_TO) };
                changed = true;
            }
        }
        return changed ? next : undefined;
    }

    protected prefixIdeBridgeWarning(property: PreferenceDataProperty): PreferenceDataProperty | undefined {
        const field = typeof property.markdownDescription === 'string'
            ? 'markdownDescription'
            : typeof property.description === 'string' ? 'description' : undefined;
        if (!field) {
            return undefined;
        }
        const value = property[field] as string;
        if (value.startsWith(IDE_BRIDGE_PREFIX) || value.includes('IDE chat bridge only')) {
            return undefined;
        }
        return { ...property, [field]: IDE_BRIDGE_PREFIX + value };
    }
}
