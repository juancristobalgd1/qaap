// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ChatMode } from '@theia/ai-chat/lib/common/chat-agents';
import { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';
import { nls } from '@theia/core/lib/common/nls';
import { hashString } from './qaap-agent-task-client';

const SELECTED_MODE_STORAGE_KEY = 'qaap.mobile.projects.selectedMode';

/** QAIQ interaction modes — Build executes; Plan drafts only. */
export const QAAP_BACKEND_INTERACTION_MODES: readonly ChatMode[] = [
    {
        id: 'agent',
        name: nls.localize('qaap/mobileProjects/modeAgent', 'Build'),
        isDefault: true,
    },
    {
        id: 'plan',
        name: nls.localize('qaap/mobileProjects/modePlan', 'Plan'),
    },
];

export type QaapComposerInteractionModeId = 'agent' | 'plan';

export function scopedModeStorageKey(cwd: string): string {
    return `${SELECTED_MODE_STORAGE_KEY}.${hashString(cwd)}`;
}

export function readStoredComposerMode(cwd: string | undefined): string | undefined {
    if (!cwd) {
        return undefined;
    }
    try {
        return window.localStorage.getItem(scopedModeStorageKey(cwd)) ?? undefined;
    } catch {
        return undefined;
    }
}

export function writeStoredComposerMode(cwd: string | undefined, modeId: string): void {
    if (!cwd) {
        return;
    }
    try {
        window.localStorage.setItem(scopedModeStorageKey(cwd), modeId);
    } catch {
        /* session-only */
    }
}

export function defaultComposerModeId(modes: readonly ChatMode[]): string {
    return modes.find(mode => mode.isDefault)?.id ?? modes[0]?.id ?? 'agent';
}

export function resolveComposerModeLabel(modes: readonly ChatMode[], modeId: string | undefined): string {
    const resolved = modes.find(mode => mode.id === modeId);
    return resolved?.name ?? modes[0]?.name ?? modeId ?? '';
}

export function reconcileComposerModeId(
    current: string | undefined,
    modes: readonly ChatMode[],
    cwd: string | undefined,
): string {
    const ids = new Set(modes.map(mode => mode.id));
    if (current && ids.has(current)) {
        return current;
    }
    const stored = readStoredComposerMode(cwd);
    if (stored && ids.has(stored)) {
        return stored;
    }
    return defaultComposerModeId(modes);
}

/** Modes shown in the Qaap mobile composer — always QAIQ product modes. */
export function resolveStickyComposerModes(
    _pinnedAgentId: string | undefined,
    _chatAgentService: ChatAgentService | undefined,
): readonly ChatMode[] {
    return QAAP_BACKEND_INTERACTION_MODES;
}

export function describeComposerInteractionMode(modeId: string | undefined): string | undefined {
    if (!modeId || modeId === 'agent') {
        return undefined;
    }
    if (modeId === 'plan') {
        return nls.localize(
            'qaap/mobileProjects/modePlanActive',
            'Plan mode — QAIQ will draft a plan only. No edits or commands until you switch to Build.',
        );
    }
    return undefined;
}

export function applyBackendInteractionModeToPrompt(prompt: string, _modeId: string | undefined): string {
    // The mode is sent separately as interactionModeId. Keep the user message intact so it is
    // recorded and titled from what the user actually typed; the backend adds the mode instruction
    // to the agent's hidden context and enforces its tool policy.
    return prompt;
}

export function resolveBackendInteractionModeSystemInstruction(modeId: string | undefined): string | undefined {
    if (modeId?.trim().toLowerCase() !== 'plan') {
        return undefined;
    }
    return nls.localize(
        'qaap/mobileProjects/planModeSystemInstruction',
        'The user selected Plan mode. Provide a concise Markdown plan with goals, steps, risks, and open questions. '
        + 'Do not modify files or run shell commands. Use only read-only inspection tools when needed.',
    );
}
