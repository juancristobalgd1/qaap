// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { KeybindingContext, KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';

/** Theia's pseudo command: a matching binding lets the key event through instead of handling it. */
const PASSTHROUGH_COMMAND = 'passthrough';

/** Class of the transcript's inline search form; it is mounted as a direct child of the element whose keydown opens it. */
export const QAAP_TRANSCRIPT_SEARCH_HOST_CLASS = 'theia-mobile-agent-transcript-search';
/** Root of the composer model picker; its host's keydown handler picks the Nth model on Cmd/Ctrl+N. */
export const QAAP_COMPOSER_MODEL_PICKER_CLASS = 'qaap-model-picker';

export const QAAP_TRANSCRIPT_SEARCH_FOCUS_CONTEXT = 'qaapTranscriptSearchFocus';
export const QAAP_MODEL_PICKER_FOCUS_CONTEXT = 'qaapComposerModelPickerFocus';

export namespace QaapWorkHubShortcutFocus {

    /** True when `element` sits inside the element that hosts the transcript's inline search (its keydown opens it). */
    export function isInTranscriptSearchHost(element: Element | undefined): boolean {
        for (let current: Element | undefined = element; current; current = current.parentElement ?? undefined) {
            for (const child of Array.from(current.children)) {
                if (child.classList.contains(QAAP_TRANSCRIPT_SEARCH_HOST_CLASS)) {
                    return true;
                }
            }
        }
        return false;
    }

    /** True when `element` is inside an open composer model picker. */
    export function isInModelPicker(element: Element | undefined): boolean {
        return !!element?.closest(`.${QAAP_COMPOSER_MODEL_PICKER_CLASS}`);
    }

    /** True while a composer model picker is on screen (its Cmd/Ctrl+1..9 work wherever focus is). */
    export function isModelPickerOpen(doc: Document = document): boolean {
        return [...doc.querySelectorAll<HTMLElement>(`.${QAAP_COMPOSER_MODEL_PICKER_CLASS}`)]
            .some(picker => picker.isConnected && picker.getClientRects().length > 0);
    }
}

/**
 * Lets Work Hub shortcuts reach their own keydown handlers. Theia's keybinding registry listens on the document in
 * the capture phase and swallows (preventDefault + stopPropagation) any key it has an enabled binding for, before
 * the Work Hub's element handlers run in the bubble phase:
 *
 * - Cmd/Ctrl+F is bound to `core.find` (a no-op handler), so the transcript's "Search conversation" never opened;
 * - Cmd/Ctrl+1..9 is bound to `workbench.action.focus<N>EditorGroup`, enabled whenever the IDE has that many editor
 *   groups, so picking a model by number in the model picker failed as soon as the IDE had an editor group.
 *
 * A `passthrough` binding for the same key, enabled only while focus is where the Work Hub handler listens, makes
 * the registry let the event through there. Registered after the core bindings, so it is matched first; everywhere
 * else the core bindings keep working.
 */
@injectable()
export class QaapWorkHubShortcutPassthroughContribution implements KeybindingContribution {

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({ command: PASSTHROUGH_COMMAND, keybinding: 'ctrlcmd+f', context: QAAP_TRANSCRIPT_SEARCH_FOCUS_CONTEXT });
        for (let digit = 1; digit <= 9; digit++) {
            keybindings.registerKeybinding({ command: PASSTHROUGH_COMMAND, keybinding: `ctrlcmd+${digit}`, context: QAAP_MODEL_PICKER_FOCUS_CONTEXT });
        }
    }
}

/** Enabled while focus is inside the transcript search host. */
@injectable()
export class QaapTranscriptSearchFocusKeybindingContext implements KeybindingContext {
    readonly id = QAAP_TRANSCRIPT_SEARCH_FOCUS_CONTEXT;

    isEnabled(): boolean {
        return QaapWorkHubShortcutFocus.isInTranscriptSearchHost(document.activeElement ?? undefined);
    }
}

/** Enabled while a composer model picker is open (focus inside it or not: it picks by number either way). */
@injectable()
export class QaapComposerModelPickerFocusKeybindingContext implements KeybindingContext {
    readonly id = QAAP_MODEL_PICKER_FOCUS_CONTEXT;

    isEnabled(): boolean {
        return QaapWorkHubShortcutFocus.isInModelPicker(document.activeElement ?? undefined)
            || QaapWorkHubShortcutFocus.isModelPickerOpen();
    }
}
