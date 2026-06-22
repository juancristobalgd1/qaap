// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';

/** Benign plugin/i18n noise on fresh browser runs — missing optional l10n bundles, etc. */
const QUIET_STARTUP_CONSOLE_PATTERNS: readonly RegExp[] = [
    /^Failed to load plugin localization bundles from /,
    /^Failed reading translation file from: /,
    /^Failed to localize plugin '/,
    /^Failed to load translation from: /,
    /^Could not read '.*' contribution 'localizations'\./,
];

function formatConsoleArgs(args: readonly unknown[]): string {
    return args.map(arg => {
        if (typeof arg === 'string') {
            return arg;
        }
        try {
            return JSON.stringify(arg);
        } catch {
            return String(arg);
        }
    }).join(' ');
}

function isQuietStartupConsoleMessage(message: string): boolean {
    return QUIET_STARTUP_CONSOLE_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Downgrades repeated optional plugin localization failures so fresh QAAP browser
 * startups stay readable in backend logs.
 */
@injectable()
export class QaapBackendStartupLogFilterContribution implements BackendApplicationContribution {

    protected readonly suppressedKeys = new Set<string>();

    initialize(): void {
        this.wrapConsoleMethod('error');
        this.wrapConsoleMethod('warn');
    }

    protected wrapConsoleMethod(level: 'error' | 'warn'): void {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            const message = formatConsoleArgs(args);
            if (!isQuietStartupConsoleMessage(message)) {
                original(...args);
                return;
            }
            if (this.suppressedKeys.has(message)) {
                return;
            }
            this.suppressedKeys.add(message);
            // One debug breadcrumb per distinct message — avoids log spam without hiding all signal.
            if (typeof process !== 'undefined' && process.env?.QAAP_VERBOSE_PLUGIN_I18N === '1') {
                original('[qaap] suppressed startup noise:', message);
            }
        };
    }
}
