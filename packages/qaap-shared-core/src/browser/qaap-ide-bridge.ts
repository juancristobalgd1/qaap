// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * IDE bridge: structural contracts through which mobile-safe Work Hub code reaches IDE-only
 * services without importing the IDE packages at runtime.
 *
 * Product rule: on mobile the Theia IDE UI never loads, but everything the Work Hub uses does. The
 * `bundle-mobile` entry must not import the plugin host, debug, VSX, ... Mobile-safe classes inject
 * these symbols with `@optional()`; they are bound as plain aliases (`toService`) of the upstream
 * service, so both entries resolve exactly the same instance as the upstream symbol. The terminal
 * aliases are bound by `qaap-work-hub-frontend-module` (both entries: the Work Hub terminal surface
 * uses them); the desktop terminal layout only by the IDE-only `qaap-work-hub-ide-frontend-module`,
 * so it resolves to `undefined` on mobile.
 *
 * Imports in this file must stay type-only (`import type`): they are erased from the bundle.
 */

import type { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import type { TerminalWatcher } from '@theia/terminal/lib/common/terminal-watcher';

/** `@theia/terminal` `TerminalService`; bound by `qaap-work-hub-frontend-module` (desktop and mobile). */
export const QaapIdeTerminalService = Symbol('QaapIdeTerminalService');
export type QaapIdeTerminalService = TerminalService;

/** `@theia/terminal` `TerminalWatcher` (backend exit/error events); bound by `qaap-work-hub-frontend-module` (desktop and mobile). */
export const QaapIdeTerminalWatcher = Symbol('QaapIdeTerminalWatcher');
export type QaapIdeTerminalWatcher = TerminalWatcher;

/** Desktop bottom-panel terminal layout (`QaapDesktopTerminalLayoutContribution`), IDE only. */
export const QaapIdeDesktopTerminalLayout = Symbol('QaapIdeDesktopTerminalLayout');
export interface QaapIdeDesktopTerminalLayout {
    ensureDesktopTerminalNormal(): Promise<void>;
}
