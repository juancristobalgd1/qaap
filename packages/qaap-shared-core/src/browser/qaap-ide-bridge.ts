// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * IDE bridge: structural contracts through which mobile-safe Work Hub code reaches IDE-only
 * services without importing the IDE packages at runtime.
 *
 * Product rule: on mobile the Theia IDE never loads, so the `bundle-mobile` entry must not import
 * `@theia/terminal`, the plugin host, debug, VSX, ... Mobile-safe classes inject these symbols with
 * `@optional()`; only the IDE-only frontend modules (loaded by desktop, excluded from
 * `bundle-mobile`) bind them, as plain aliases (`toService`) of the upstream service, so desktop
 * resolves exactly the same instance as before. On mobile they resolve to `undefined`.
 *
 * Imports in this file must stay type-only (`import type`): they are erased from the bundle.
 */

import type { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import type { TerminalWatcher } from '@theia/terminal/lib/common/terminal-watcher';

/** `@theia/terminal` `TerminalService`; bound by `qaap-work-hub-ide-frontend-module` only. */
export const QaapIdeTerminalService = Symbol('QaapIdeTerminalService');
export type QaapIdeTerminalService = TerminalService;

/** `@theia/terminal` `TerminalWatcher` (backend exit/error events); bound by `qaap-work-hub-ide-frontend-module` only. */
export const QaapIdeTerminalWatcher = Symbol('QaapIdeTerminalWatcher');
export type QaapIdeTerminalWatcher = TerminalWatcher;

/** Desktop bottom-panel terminal layout (`QaapDesktopTerminalLayoutContribution`), IDE only. */
export const QaapIdeDesktopTerminalLayout = Symbol('QaapIdeDesktopTerminalLayout');
export interface QaapIdeDesktopTerminalLayout {
    ensureDesktopTerminalNormal(): Promise<void>;
}
