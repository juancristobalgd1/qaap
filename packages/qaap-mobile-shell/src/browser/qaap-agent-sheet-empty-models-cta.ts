// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

export interface QaapEmptyModelsCtaOptions {
    /** When true, copy points at Settings → AI Features (QAIQ / BYOK catalog). */
    readonly settingsCatalog: boolean;
    /** Opens Work Hub preferences filtered to AI Features. */
    readonly onOpenAiFeatures?: () => void;
    readonly emptyAgentMessage?: string;
}

/**
 * Empty model-list body for agent pickers: hint + optional CTA into AI Features
 * so users without API keys can add credentials without hunting through menus.
 */
export function createEmptyAgentModelsCta(options: QaapEmptyModelsCtaOptions): HTMLElement {
    const block = document.createElement('div');
    block.className = 'theia-qaap-agent-sheet-empty-models-block';
    const hint = document.createElement('p');
    hint.className = 'theia-qaap-agent-sheet-empty-models';
    hint.textContent = options.settingsCatalog
        ? nls.localize(
            'qaap/mobileProjects/stickyComposerNoQaiqModels',
            'Add an API key in Settings → AI Features to choose a model.',
        )
        : (options.emptyAgentMessage ?? nls.localize(
            'qaap/mobileProjects/stickyComposerNoAgentModels',
            'No models are available for this agent on the workspace.',
        ));
    block.append(hint);
    if (options.settingsCatalog && options.onOpenAiFeatures) {
        const openSettings = document.createElement('button');
        openSettings.type = 'button';
        openSettings.className = 'theia-qaap-agent-sheet-retry theia-qaap-agent-sheet-open-ai-features';
        openSettings.textContent = nls.localize(
            'qaap/mobileProjects/openAiFeaturesSettings',
            'Open AI Features',
        );
        openSettings.addEventListener('click', () => options.onOpenAiFeatures?.());
        block.append(openSettings);
    }
    return block;
}
