// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, nls } from '@theia/core';
import {
    QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND,
    QAAP_WORK_HUB_OPEN_PARALLEL_RUNS_COMMAND,
    QAAP_WORK_HUB_PICK_AGENT_AND_SUBMIT_PROMPT_COMMAND,
    QAAP_WORK_HUB_SUBMIT_COMPOSER_PROMPT_COMMAND,
    type QaapAttachComposerContextArgs,
    type QaapWorkHubPickAgentAndSubmitPromptOptions,
    type QaapWorkHubSubmitComposerPromptOptions,
} from '../common/qaap-work-hub-composer-prompt';
import { isQaapAttachComposerContextArgs } from '../common/qaap-preview-feedback-context';
import { QaapWorkHubComposerPromptService } from './qaap-work-hub-composer-prompt-service';

@injectable()
export class QaapWorkHubComposerPromptContribution implements CommandContribution {

    @inject(QaapWorkHubComposerPromptService)
    protected readonly composerPrompts: QaapWorkHubComposerPromptService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({
            id: QAAP_WORK_HUB_SUBMIT_COMPOSER_PROMPT_COMMAND,
            label: nls.localize('qaap/workHub/submitComposerPrompt', 'Submit prompt to Work Hub agent'),
            category: 'Qaap',
        }, {
            execute: (prompt: string, options?: QaapWorkHubSubmitComposerPromptOptions) =>
                this.composerPrompts.submitPrompt(prompt, options),
        });
        registry.registerCommand({
            id: QAAP_WORK_HUB_PICK_AGENT_AND_SUBMIT_PROMPT_COMMAND,
            label: nls.localize(
                'qaap/workHub/pickAgentAndSubmitComposerPrompt',
                'Choose agent and submit Work Hub prompt',
            ),
            category: 'Qaap',
        }, {
            execute: (prompt: string, options?: QaapWorkHubPickAgentAndSubmitPromptOptions) =>
                this.composerPrompts.pickAgentAndSubmitPrompt(prompt, options),
        });
        registry.registerCommand({
            id: QAAP_WORK_HUB_OPEN_PARALLEL_RUNS_COMMAND,
            label: nls.localize('qaap/workHub/openParallelRunsSheet', 'Open Parallel runs sheet'),
            category: 'Qaap',
        }, {
            execute: (prompt: string) => this.composerPrompts.openParallelRunsSheet(prompt),
        });
        registry.registerCommand({
            id: QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND,
            label: nls.localize('qaap/workHub/attachComposerContext', 'Attach context to Work Hub composer'),
            category: 'Qaap',
        }, {
            execute: (args: QaapAttachComposerContextArgs) => {
                if (!isQaapAttachComposerContextArgs(args)) {
                    return false;
                }
                return this.composerPrompts.attachComposerContext(args);
            },
        });
    }
}
