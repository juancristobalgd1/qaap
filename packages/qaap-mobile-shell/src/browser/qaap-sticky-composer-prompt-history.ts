// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import {
    ChatInputHistoryService,
    ChatInputNavigationState,
} from '@theia/ai-chat-ui/lib/browser/chat-input-history';
import {
    isStickyComposerMentionPopoverOpen,
    isTextareaCaretAtBeginning,
    isTextareaCaretAtEnd,
} from '../common/qaap-sticky-composer-prompt-history-core';

export {
    isStickyComposerMentionPopoverOpen,
    isTextareaCaretAtBeginning,
    isTextareaCaretAtEnd,
    textareaCaretLineColumn,
} from '../common/qaap-sticky-composer-prompt-history-core';

let historyService: ChatInputHistoryService | undefined;
const navigationByInput = new WeakMap<HTMLTextAreaElement, ChatInputNavigationState>();

export function registerStickyComposerPromptHistoryService(service: ChatInputHistoryService): void {
    historyService = service;
    void service.init();
}

function resolveNavigationState(input: HTMLTextAreaElement): ChatInputNavigationState | undefined {
    if (!historyService) {
        return undefined;
    }
    let navigation = navigationByInput.get(input);
    if (!navigation) {
        navigation = new ChatInputNavigationState(historyService);
        navigationByInput.set(input, navigation);
    }
    return navigation;
}

export function recordStickyComposerPromptSubmission(input: HTMLTextAreaElement, prompt: string): void {
    const trimmed = prompt.trim();
    if (!trimmed || !historyService) {
        return;
    }
    historyService.addToHistory(trimmed);
    resolveNavigationState(input)?.stopNavigation();
}

export function handleStickyComposerPromptHistoryKeydown(
    input: HTMLTextAreaElement,
    ev: KeyboardEvent,
    callbacks: {
        readonly setDraft: (value: string) => void;
        readonly afterInputChange?: () => void;
    },
): boolean {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') {
        return false;
    }
    if (ev.defaultPrevented || isStickyComposerMentionPopoverOpen(input)) {
        return false;
    }
    const navigation = resolveNavigationState(input);
    if (!navigation || historyService!.getPrompts().length === 0) {
        return false;
    }

    if (ev.key === 'ArrowUp') {
        if (!isTextareaCaretAtBeginning(input)) {
            input.setSelectionRange(0, 0);
            ev.preventDefault();
            return true;
        }
        const previousPrompt = navigation.getPreviousPrompt(input.value);
        if (previousPrompt === undefined) {
            return false;
        }
        applyStickyComposerPrompt(input, previousPrompt, callbacks);
        ev.preventDefault();
        return true;
    }

    if (!isTextareaCaretAtEnd(input)) {
        const end = input.value.length;
        input.setSelectionRange(end, end);
        ev.preventDefault();
        return true;
    }
    const nextPrompt = navigation.getNextPrompt();
    if (nextPrompt === undefined) {
        return false;
    }
    applyStickyComposerPrompt(input, nextPrompt, callbacks);
    ev.preventDefault();
    return true;
}

function applyStickyComposerPrompt(
    input: HTMLTextAreaElement,
    prompt: string,
    callbacks: {
        readonly setDraft: (value: string) => void;
        readonly afterInputChange?: () => void;
    },
): void {
    input.value = prompt;
    callbacks.setDraft(prompt);
    const end = prompt.length;
    input.setSelectionRange(end, end);
    callbacks.afterInputChange?.();
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

@injectable()
export class QaapStickyComposerPromptHistoryContribution implements FrontendApplicationContribution {
    @inject(ChatInputHistoryService)
    protected readonly historyService!: ChatInputHistoryService;

    onStart(): void {
        registerStickyComposerPromptHistoryService(this.historyService);
    }
}
