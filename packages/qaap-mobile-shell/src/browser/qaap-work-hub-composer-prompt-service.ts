// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Disposable } from '@theia/core/lib/common/disposable';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { createConversation } from '../common/qaap-agent-conversation-client';
import {
    QAAP_COMPOSER_DEFAULT_AGENT_ID,
    readStoredAgent,
    type QaapCreateAgentTaskQaiqModel,
} from '../common/qaap-agent-task-client';
import { resolveStoredAgentModelForSubmit } from '../common/qaap-agent-model-selection';
import type {
    QaapAttachComposerContextArgs,
    QaapWorkHubPickAgentAndSubmitPromptOptions,
    QaapWorkHubSubmitComposerPromptOptions,
} from '../common/qaap-work-hub-composer-prompt';
import type { MobileProjectsPanel } from './mobile-projects-panel';

/**
 * Routes external prompts (Element Inspector, etc.) to the Work Hub agent currently
 * selected in the sticky composer — never to the legacy Theia Chat `@coder` path.
 */
@injectable()
export class QaapWorkHubComposerPromptService {

    protected readonly panels = new Set<MobileProjectsPanel>();

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(MessageService)
    protected readonly messages: MessageService;

    trackPanel(panel: MobileProjectsPanel): Disposable {
        this.panels.add(panel);
        return Disposable.create(() => {
            this.panels.delete(panel);
        });
    }

    async submitPrompt(prompt: string, options: QaapWorkHubSubmitComposerPromptOptions = {}): Promise<void> {
        const text = typeof prompt === 'string' ? prompt.trim() : '';
        if (!text) {
            return;
        }
        const ordered = [...this.panels].sort((left, right) => Number(right.isVisible()) - Number(left.isVisible()));
        for (const panel of ordered) {
            if (await panel.submitExternalComposerPrompt(text, options)) {
                return;
            }
        }
        await this.submitViaHttp(text, options);
    }

    /**
     * Show the agent/model picker, then submit with the chosen agent.
     * Falls back to immediate submit with the stored/default agent when no panel is available.
     */
    async pickAgentAndSubmitPrompt(
        prompt: string,
        options: QaapWorkHubPickAgentAndSubmitPromptOptions = {},
    ): Promise<void> {
        const text = typeof prompt === 'string' ? prompt.trim() : '';
        if (!text) {
            return;
        }
        const ordered = [...this.panels].sort((left, right) => Number(right.isVisible()) - Number(left.isVisible()));
        for (const panel of ordered) {
            if (panel.pickAgentAndSubmitExternalPrompt(text, options)) {
                return;
            }
        }
        // No Work Hub panel — submit with the stored agent rather than blocking the user.
        await this.submitViaHttp(text);
    }

    async openParallelRunsSheet(prompt: string): Promise<void> {
        const text = typeof prompt === 'string' ? prompt.trim() : '';
        if (!text) {
            return;
        }
        const ordered = [...this.panels].sort((left, right) => Number(right.isVisible()) - Number(left.isVisible()));
        for (const panel of ordered) {
            if (panel.openExternalParallelRunsSheet(text)) {
                return;
            }
        }
        this.messages.warn(nls.localize(
            'qaap/workHub/parallelRunsUnavailable',
            'Open Work Hub with a workspace project before running variants.',
        ));
    }

    /**
     * Attach a removable context chip to the active Work Hub composer.
     * When {@link QaapAttachComposerContextArgs.submit} is true, also sends a message
     * that includes the context to the current chat.
     */
    async attachComposerContext(args: QaapAttachComposerContextArgs): Promise<boolean> {
        const ordered = [...this.panels].sort((left, right) => Number(right.isVisible()) - Number(left.isVisible()));
        for (const panel of ordered) {
            if (args.submit) {
                if (await panel.sendExternalComposerContext(args)) {
                    return true;
                }
            } else if (panel.attachExternalComposerContext(args)) {
                return true;
            }
        }
        this.messages.warn(nls.localize(
            'qaap/workHub/attachComposerUnavailable',
            'Open Work Hub before attaching preview feedback to the composer.',
        ));
        return false;
    }

    protected async submitViaHttp(
        prompt: string,
        options: QaapWorkHubSubmitComposerPromptOptions = {},
    ): Promise<void> {
        const cwd = await this.resolveWorkspaceCwd();
        if (!cwd) {
            this.messages.warn(nls.localize(
                'qaap/workHub/composerPromptNoWorkspace',
                'Open a workspace project before asking the agent.',
            ));
            return;
        }
        const agent = options.agentId ?? readStoredAgent(cwd) ?? QAAP_COMPOSER_DEFAULT_AGENT_ID;
        const agentModel = options.agentModel ?? resolveStoredAgentModelForSubmit(agent, cwd);
        try {
            await createConversation({
                cwd,
                agent,
                title: prompt,
                message: prompt,
                ...(agentModel ? { agentModel, qaiqModel: agentModel } : {}),
            });
            this.messages.info(nls.localize(
                'qaap/workHub/composerPromptStarted',
                'Task started with {0}.',
                agent,
            ));
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.messages.error(nls.localize(
                'qaap/workHub/composerPromptFailed',
                'Could not start task: {0}',
                detail,
            ));
        }
    }

    protected async resolveWorkspaceCwd(): Promise<string | undefined> {
        const root = this.workspaceService.tryGetRoots()[0];
        if (!root) {
            return undefined;
        }
        return this.fileService.fsPath(root.resource);
    }
}

export type { QaapCreateAgentTaskQaiqModel };
