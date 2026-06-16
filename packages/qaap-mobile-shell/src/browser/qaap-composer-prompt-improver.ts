// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { CancellationTokenSource } from '@theia/core/lib/common/cancellation';
import { generateUuid } from '@theia/core/lib/common/uuid';
import {
    FrontendLanguageModelRegistry,
    LanguageModelService,
    getTextOfResponse,
    type LanguageModel,
} from '@theia/ai-core/lib/common';
import type { QaapAgentModelSelection } from '../common/qaap-agent-model-selection';
import {
    COMPOSER_PROMPT_IMPROVER_AGENT_ID,
    COMPOSER_PROMPT_IMPROVER_FALLBACK_ALIASES,
    COMPOSER_PROMPT_IMPROVE_TIMEOUT_MS,
    QAAP_COMPOSER_IMPROVE_API_PATH,
    ComposerPromptImproveCancelledError,
    buildImproveComposerPromptRequest,
    formatAgentModelLanguageModelId,
    sanitizeImprovedComposerPrompt,
    type QaapImproveComposerPromptResponseBody,
} from '../common/qaap-composer-prompt-improve';

export interface ImproveComposerPromptRequest {
    readonly prompt: string;
    readonly agentId: string;
    readonly agentModel?: QaapAgentModelSelection;
    readonly cwd?: string;
}

@injectable()
export class QaapComposerPromptImprover {

    @inject(FrontendLanguageModelRegistry) @optional()
    protected readonly languageModelRegistry?: FrontendLanguageModelRegistry;

    @inject(LanguageModelService) @optional()
    protected readonly languageModelService?: LanguageModelService;

    protected activeCancel: CancellationTokenSource | undefined;
    protected activeAbort: AbortController | undefined;

    cancelActive(): void {
        this.activeCancel?.cancel();
        this.activeCancel = undefined;
        this.activeAbort?.abort();
        this.activeAbort = undefined;
    }

    async improve(request: ImproveComposerPromptRequest): Promise<string> {
        const trimmed = request.prompt.trim();
        if (!trimmed) {
            throw new Error('Composer prompt is empty');
        }
        this.cancelActive();
        const tokenSource = new CancellationTokenSource();
        const abort = new AbortController();
        this.activeCancel = tokenSource;
        this.activeAbort = abort;
        const timeout = window.setTimeout(() => {
            tokenSource.cancel();
            abort.abort();
        }, COMPOSER_PROMPT_IMPROVE_TIMEOUT_MS);
        try {
            const backend = await this.tryImproveViaBackend(request, abort.signal);
            if (backend) {
                if (tokenSource.token.isCancellationRequested || abort.signal.aborted) {
                    throw new ComposerPromptImproveCancelledError();
                }
                return backend;
            }
            const model = await this.pickModel(request.agentModel);
            if (!model || !this.languageModelService) {
                throw new Error('No language model is ready for prompt improvement');
            }
            const response = await this.languageModelService.sendRequest(model, {
                messages: [{
                    actor: 'user',
                    type: 'text',
                    text: buildImproveComposerPromptRequest(trimmed),
                }],
                sessionId: generateUuid(),
                requestId: generateUuid(),
                agentId: COMPOSER_PROMPT_IMPROVER_AGENT_ID,
                cancellationToken: tokenSource.token,
            });
            if (tokenSource.token.isCancellationRequested || abort.signal.aborted) {
                throw new ComposerPromptImproveCancelledError();
            }
            const improved = sanitizeImprovedComposerPrompt(await getTextOfResponse(response));
            if (!improved) {
                throw new Error('The model returned an empty prompt');
            }
            return improved;
        } catch (error) {
            if (tokenSource.token.isCancellationRequested || abort.signal.aborted) {
                throw new ComposerPromptImproveCancelledError();
            }
            throw error;
        } finally {
            window.clearTimeout(timeout);
            if (this.activeCancel === tokenSource) {
                this.activeCancel = undefined;
            }
            if (this.activeAbort === abort) {
                this.activeAbort = undefined;
            }
        }
    }

    protected async tryImproveViaBackend(
        request: ImproveComposerPromptRequest,
        signal: AbortSignal,
    ): Promise<string | undefined> {
        try {
            const response = await fetch(QAAP_COMPOSER_IMPROVE_API_PATH, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: request.prompt.trim(),
                    agentId: request.agentId,
                    agentModel: request.agentModel,
                    cwd: request.cwd,
                }),
                signal,
            });
            if (signal.aborted) {
                throw new ComposerPromptImproveCancelledError();
            }
            if (!response.ok) {
                let message = `Prompt improvement failed (${response.status}).`;
                try {
                    const payload = await response.json() as { error?: string };
                    if (payload.error?.trim()) {
                        message = payload.error.trim();
                    }
                } catch {
                    // Keep generic message.
                }
                throw new Error(message);
            }
            const payload = await response.json() as QaapImproveComposerPromptResponseBody;
            if (signal.aborted) {
                throw new ComposerPromptImproveCancelledError();
            }
            const improved = sanitizeImprovedComposerPrompt(payload.improved ?? '');
            if (!improved) {
                throw new Error('Agent returned an empty prompt');
            }
            return improved;
        } catch (error) {
            if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
                throw new ComposerPromptImproveCancelledError();
            }
            if (error instanceof TypeError) {
                return undefined;
            }
            throw error;
        }
    }

    protected async pickModel(agentModel: QaapAgentModelSelection | undefined): Promise<LanguageModel | undefined> {
        if (!this.languageModelRegistry) {
            return undefined;
        }
        if (agentModel) {
            const explicitId = formatAgentModelLanguageModelId(agentModel);
            if (explicitId) {
                try {
                    const model = await this.languageModelRegistry.getReadyLanguageModel(explicitId);
                    if (model) {
                        return model;
                    }
                } catch {
                    // Fall through to aliases / scan.
                }
            }
        }
        for (const alias of COMPOSER_PROMPT_IMPROVER_FALLBACK_ALIASES) {
            try {
                const model = await this.languageModelRegistry.getReadyLanguageModel(alias);
                if (model) {
                    return model;
                }
            } catch {
                // Try the next alias.
            }
        }
        try {
            const models = await this.languageModelRegistry.getLanguageModels();
            for (const descriptor of models) {
                const model = await this.languageModelRegistry.getReadyLanguageModel(descriptor.id);
                if (model) {
                    return model;
                }
            }
        } catch {
            return undefined;
        }
        return undefined;
    }
}
