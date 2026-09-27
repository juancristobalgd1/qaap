// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { KeybindingRegistry, ResolvedKeybinding } from '@theia/core/lib/browser/keybinding';
import { KeyCode } from '@theia/core/lib/common/keys';
import { peekPreferDesktopIde } from '../common/qaap-mobile-work-surface-preference';

/**
 * Qaap override of the Theia keybinding registry.
 *
 * In the Work Hub surface (the default product surface), the Theia keybinding
 * system's capture-phase `keydown` listener on `document` can intercept native
 * browser editing shortcuts (Cmd/Ctrl+V, Cmd/Ctrl+C, Cmd/Ctrl+X, Cmd/Ctrl+A,
 * Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z). When a shortcut matches a chord prefix
 * (partial match) or a registered command, `KeybindingRegistry.run()` calls
 * `preventDefault()` on the event, which cancels the browser's native action —
 * e.g. the `paste` event never fires, so paste-from-clipboard silently does
 * nothing in the composer textarea.
 *
 * This subclass short-circuits `run()` for native editing shortcuts when the
 * user is in the Work Hub (not `preferDesktopIde`). The event is left untouched
 * (no `preventDefault()`, no `stopPropagation()`), so it propagates normally to
 * the focused element and the browser performs its default action.
 *
 * In the classic IDE (`preferDesktopIde`), the upstream `run()` runs unchanged
 * — all Theia/Monaco keybindings work as expected.
 */
@injectable()
export class QaapKeybindingRegistry extends KeybindingRegistry {

    private static readonly NATIVE_SHORTCUT_KEYS = new Set(['v', 'c', 'x', 'a', 'z', 'r']);

    override run(event: KeyboardEvent): void {
        if (this.shouldPassthroughNativeShortcut(event) || this.shouldPassthroughComposerDeliveryShortcut(event)) {
            // Reset the chord sequence so a stale partial match doesn't carry
            // over to the next keystroke.
            this.keySequence = [];
            return;
        }
        super.run(event);
    }

    override resolveKeybinding(binding: ResolvedKeybinding | undefined): KeyCode[] {
        // Some optional command integrations ask for their first binding before the
        // contribution has registered it. Keep that query harmless in the Qaap shell.
        return binding ? super.resolveKeybinding(binding) : [];
    }

    /**
     * Determines whether the keyboard event is a native browser editing
     * shortcut that should bypass the Theia keybinding system in Work Hub mode.
     *
     * Conditions:
     * - The user is NOT in the classic IDE (`!peekPreferDesktopIde()`).
     * - The keystroke includes Cmd (macOS) or Ctrl (non-macOS) — not both.
     * - No Alt key (Alt-based shortcuts are not native editing shortcuts).
     * - The key is one of: v, c, x, a, z, r (paste, copy, cut, select all,
     *   undo, redo, reload).
     * - Shift is allowed only for Z (Cmd+Shift+Z = redo on macOS).
     */
    protected shouldPassthroughNativeShortcut(event: KeyboardEvent): boolean {
        // In the classic IDE, let Theia handle all keybindings normally.
        if (peekPreferDesktopIde()) {
            return false;
        }

        const hasMeta = event.metaKey || event.ctrlKey;
        if (!hasMeta) {
            return false;
        }

        // Alt-modified shortcuts are not native editing shortcuts.
        if (event.altKey) {
            return false;
        }

        const key = event.key.toLowerCase();
        if (!QaapKeybindingRegistry.NATIVE_SHORTCUT_KEYS.has(key)) {
            return false;
        }

        // Shift is only allowed for Z (redo: Cmd+Shift+Z) and R (hard reload).
        if (event.shiftKey && key !== 'z' && key !== 'r') {
            return false;
        }

        return true;
    }

    /**
     * Cmd/Ctrl+Enter in the sticky composer must reach the textarea handler
     * (Interrupt) instead of a Theia command such as SCM commit.
     */
    protected shouldPassthroughComposerDeliveryShortcut(event: KeyboardEvent): boolean {
        if (event.key !== 'Enter' || event.altKey || event.shiftKey) {
            return false;
        }
        if (!(event.metaKey || event.ctrlKey)) {
            return false;
        }
        const target = event.target;
        return target instanceof HTMLElement
            && target.classList.contains('theia-mobile-projects-sticky-composer-input');
    }
}
