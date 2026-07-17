// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapCreateAgentTaskQaiqModel } from './qaap-agent-task-client';
export {
    QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND,
    type QaapAttachComposerContextArgs,
} from './qaap-preview-feedback-context';

/** Submit a prompt to the sticky-composer / Work Hub agent (not Theia Chat @coder). */
export const QAAP_WORK_HUB_SUBMIT_COMPOSER_PROMPT_COMMAND = 'qaap.workHub.submitComposerPrompt';

/**
 * Open the agent/model picker, then submit the prompt with the user's choice.
 * Used by Element Inspector "Generate UI variant", etc.
 */
export const QAAP_WORK_HUB_PICK_AGENT_AND_SUBMIT_PROMPT_COMMAND = 'qaap.workHub.pickAgentAndSubmitComposerPrompt';

/** Open the Parallel runs multi-agent sheet with a prefilled task prompt. */
export const QAAP_WORK_HUB_OPEN_PARALLEL_RUNS_COMMAND = 'qaap.workHub.openParallelRunsSheet';

export interface QaapWorkHubSubmitComposerPromptOptions {
    readonly agentId?: string;
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
}

export interface QaapWorkHubPickAgentAndSubmitPromptOptions {
    /** Sheet title on the agents list (defaults to "Choose agent"). */
    readonly title?: string;
    /** Short helper under the title. */
    readonly intro?: string;
    /** Optional popover anchor (desktop); mobile always uses a bottom sheet. */
    readonly anchor?: HTMLElement;
}
