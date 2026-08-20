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
                id: 'ai-features.workHub',
                label: nls.localize('qaap/preferences/ai-features/workHub', 'Work Hub'),
                settings: [
                    'ai-features.agentSettings.details',
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
                label: nls.localize('theia/preferences/ai-features/open-ai-official', '{0} Official Models', 'Open AI'),
                settings: ['ai-features.openAiOfficial.*'],
            },
            {
                id: 'ai-features.openAiCustom',
                label: nls.localize('theia/preferences/ai-features/open-ai-custom', '{0} Custom Models', 'Open AI'),
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
                id: 'ai-features.mcp',
                label: nls.localizeByDefault('MCP'),
                settings: ['ai-features.mcp.*'],
            },
            {
                id: 'ai-features.modelSettings',
                label: nls.localize('qaap/preferences/ai-features/modelAliases', 'Model aliases (QAIQ)'),
                settings: ['ai-features.modelSettings.*', 'ai-features.languageModelAliases'],
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
            {
                id: 'ai-features.claudeCode',
                label: nls.localize('qaap/preferences/ai-features/claudeIdeBridge', 'Claude IDE bridge'),
                settings: ['ai-features.claudeCode.*'],
            },
            {
                id: 'ai-features.codex',
                label: nls.localize('qaap/preferences/ai-features/codexIdeBridge', 'Codex IDE bridge'),
                settings: ['ai-features.codex.*'],
            },
        ];
    }
}
