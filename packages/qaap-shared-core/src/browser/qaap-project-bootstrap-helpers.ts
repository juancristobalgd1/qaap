// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Pure helpers extracted from QaapProjectBootstrapService.
// These functions operate only on their parameters and do not access instance state.

import URI from '@theia/core/lib/common/uri';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import type { QaapBootstrapPhase, QaapProjectDescriptor } from './qaap-project-bootstrap-types';
import { normalizePersistedBootstrapPhase } from '../common/qaap-project-bootstrap-phase';

// ─── Regex constants ─────────────────────────────────────────────────────────

/** Extracts `127.0.0.1:3000` / `localhost:5173` from an `EADDRINUSE` line. */
export const PORT_IN_USE_ADDR_REGEX = /(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|::1):(\d{2,5})/i;

// ─── Identity ────────────────────────────────────────────────────────────────

export function previewProjectId(workspaceRoot: URI): string {
    return workspaceRoot.toString();
}

/** Identity for a preview claim: the detected clone root, never a leftover Theia workspace. */
export function resolvePreviewClaimWorkspaceRoot(ctx: {
        readonly _descriptor?: { readonly rootUri?: URI };
        readonly activeWorkspaceRoot?: URI;
    }, cwd: URI): URI {
    return ctx._descriptor?.rootUri ?? cwd ?? ctx.activeWorkspaceRoot;
}

/** True when Work Hub pinned a clone that is not the currently open Theia folder. */
export function shouldIgnoreWorkspaceRefreshForHubPin(
    pinnedRoot: string | undefined,
    theiaWorkspaceRoot: string | undefined,
): boolean {
    return !!pinnedRoot && theiaWorkspaceRoot !== pinnedRoot;
}

// ─── URL / port utilities ────────────────────────────────────────────────────

export function normalizeDevUrl(raw: string): string | undefined {
    try {
        // Trim trailing punctuation introduced by log decorations (e.g. `).`, `,`).
        const sanitized = raw.replace(/[),.;]+$/, '');
        const parsed = new URL(sanitized);
        // Drop empty paths so we keep the URL canonical for the dedup map.
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return undefined;
    }
}

export function extractPortFromInUseMessage(text: string): number | undefined {
    const match = PORT_IN_USE_ADDR_REGEX.exec(text);
    if (!match) {
        return undefined;
    }
    const port = Number(match[1]);
    return Number.isFinite(port) ? port : undefined;
}

// ─── Phase normalization ─────────────────────────────────────────────────────

export function normalizeRestoredPhase(phase: QaapBootstrapPhase, descriptor: QaapProjectDescriptor): QaapBootstrapPhase {
    return normalizePersistedBootstrapPhase(phase, descriptor.nodeModulesPresent);
}

// ─── Terminal utilities ──────────────────────────────────────────────────────

export function readTerminalTail(terminal: TerminalWidget, maxLines: number = 40): string {
    try {
        const length = terminal.buffer.length;
        const start = Math.max(0, length - maxLines);
        return terminal.buffer.getLines(start, length - start, true).join('\n');
    } catch {
        return '';
    }
}

export function disposeBootstrapTerminal(terminal: TerminalWidget | undefined): void {
    if (!terminal) {
        return;
    }
    try {
        if (!terminal.isDisposed) {
            terminal.dispose();
        }
    } catch {
        /* widget may already be gone after a full page reload */
    }
}

// ─── Timing ──────────────────────────────────────────────────────────────────

export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
