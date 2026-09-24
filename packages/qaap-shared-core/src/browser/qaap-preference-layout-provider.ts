// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { injectable } from '@theia/core/shared/inversify';
import {
    PreferenceLayout,
    PreferenceLayoutProvider,
} from '@theia/preferences/lib/browser/util/preference-layout';

/**
 * Work Hub–oriented AI Features layout:
 * BYOK + MCP + aliases/skills first; IDE-only groups labeled as such.
 * Hidden prefs are filtered by schema `hidden`.
 */
@injectable()
export class QaapPreferenceLayoutProvider extends PreferenceLayoutProvider {

    override getLayout(): PreferenceLayout[] {
        const layout = super.getLayout().map(section => {
            if (section.id !== 'ai-features') {
                return section;
            }
            return {
                ...section,
                children: this.buildAiFeaturesChildren(),
            };
        });
        return layout;
    }

    protected buildAiFeaturesChildren(): PreferenceLayout[] {
        return [
            {
                id: 'ai-features.agents',
                label: nls.localize('qaap/preferences/ai-features/agents', 'Agents & runtimes'),
                settings: [
                    'ai-features.agentSettings',
                    'ai-features.agentSettings.details',
                    'ai-features.harness.*',
                    'ai-features.skills.disabledSkills',
                ],
            },
            {
                id: 'ai-features.workHub',
                label: nls.localize('qaap/preferences/ai-features/workHub', 'Work Hub guidance'),
                settings: [
                    'ai-features.modelSelection.details',
                    'ai-features.promptTemplates.details',
                ],
            },
            {
                id: 'ai-features.openrouter',
                label: 'OpenRouter',
                settings: ['ai-features.openrouter.*'],
            },
            {
                id: 'ai-features.nvidia',
                label: 'NVIDIA',
                settings: ['ai-features.nvidia.*'],
            },
            {
                id: 'ai-features.anthropic',
                label: 'Anthropic',
                settings: ['ai-features.anthropic.*'],
            },
            {
                id: 'ai-features.google',
                label: 'Google',
                settings: ['ai-features.google.*'],
            },
            {
                id: 'ai-features.openAiOfficial',
                label: 'OpenAI',
                settings: ['ai-features.openAiOfficial.*'],
            },
            {
                id: 'ai-features.openAiCustom',
                label: nls.localize('qaap/preferences/ai-features/open-ai-custom', 'OpenAI-compatible (custom)'),
                settings: ['ai-features.openAiCustom.*'],
            },
            {
                id: 'ai-features.huggingFace',
                label: 'Hugging Face',
                settings: ['ai-features.huggingFace.*'],
            },
            {
                id: 'ai-features.ollama',
                label: 'Ollama',
                settings: ['ai-features.ollama.*', 'ai-features.ollama'],
            },
            {
                id: 'ai-features.routing',
                label: nls.localize('qaap/preferences/ai-features/routing', 'Model routing & behavior'),
                settings: [
                    'ai-features.modelSettings.*',
                    'ai-features.languageModelAliases',
                    'ai-features.reasoning.*',
                ],
            },
            {
                id: 'ai-features.integrations',
                label: nls.localize('qaap/preferences/ai-features/integrations', 'Tools, skills & prompts'),
                children: [
                    {
                        id: 'ai-features.mcp',
                        label: nls.localizeByDefault('MCP'),
                        settings: ['ai-features.mcp.*'],
                    },
                    {
                        id: 'ai-features.skills',
                        label: nls.localizeByDefault('Skills'),
                        settings: ['ai-features.skills.*'],
                    },
                    {
                        id: 'ai-features.promptTemplates',
                        label: nls.localize('qaap/preferences/ai-features/idePromptFolders', 'Prompt folders (IDE chat)'),
                        settings: ['ai-features.promptTemplates.*'],
                    },
                ],
            },
            {
                id: 'ai-features.ideBridges',
                label: nls.localize('qaap/preferences/ai-features/ideBridges', 'IDE bridges'),
                settings: ['ai-features.claudeCode.*', 'ai-features.codex.*'],
            },
        ];
    }
}
