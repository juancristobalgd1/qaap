// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * The composer's "Improve prompt" action, offered as an item of the "+" attach menu. It runs the same
 * control as the former input button, so the prompt is improved by the same handler.
 */
export interface ComposerImprovePromptAction {
    /** The composer textarea the menu watches while it is open. */
    readonly input: HTMLTextAreaElement;
    /** Whether the textarea holds text; an empty prompt disables the menu item. */
    hasText(): boolean;
    /** Runs the improve control of the composer that owns the attach button. */
    run(): void;
}

/** Keyed by the composer's attach button, the anchor the attach menu opens from. */
const improvePromptActions = new WeakMap<HTMLElement, ComposerImprovePromptAction>();

export function registerComposerImprovePromptAction(attachAnchor: HTMLElement, action: ComposerImprovePromptAction): void {
    improvePromptActions.set(attachAnchor, action);
}

export function getComposerImprovePromptAction(attachAnchor: HTMLElement | undefined): ComposerImprovePromptAction | undefined {
    return attachAnchor ? improvePromptActions.get(attachAnchor) : undefined;
}
