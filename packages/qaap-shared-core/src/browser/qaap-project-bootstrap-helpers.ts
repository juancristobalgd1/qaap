// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Pure helpers extracted from QaapProjectBootstrapService.
// These functions operate only on their parameters and do not access instance state.

import URI from '@theia/core/lib/common/uri';
import { Disposable, Event } from '@theia/core/lib/common';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import type { QaapBootstrapPhase, QaapProjectDescriptor } from './qaap-project-bootstrap-types';
import { normalizePersistedBootstrapPhase } from '../common/qaap-project-bootstrap-phase';
import { lastDevOutputLines } from './qaap-project-bootstrap-dev-errors';
import { hasQaapUnrenderedOutput } from './qaap-terminal-unrendered-output';

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

/** Extracts the port from Vite's strict-port failure, `Error: Port 5173 is already in use`. */
export const PORT_IN_USE_PHRASE_REGEX = /\bport (\d{2,5}) is (?:already )?in use/i;

export function extractPortFromInUseMessage(text: string): number | undefined {
    const match = PORT_IN_USE_ADDR_REGEX.exec(text) ?? PORT_IN_USE_PHRASE_REGEX.exec(text);
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

/**
 * The last `maxLines` lines of real terminal output. The xterm buffer always holds a full viewport,
 * so a process that printed a few lines and exited leaves blank rows under the cursor: reading the
 * raw last rows returned only newlines, which then replaced the exit diagnostic with an empty
 * error. Trailing blank rows are skipped, and an all-blank buffer yields `''` so callers fall back.
 */
export function readTerminalTail(terminal: TerminalWidget, maxLines: number = 40): string {
    let rendered = '';
    try {
        let end = terminal.buffer.length;
        while (end > 0 && !terminal.buffer.getLines(end - 1, 1, true)[0]?.trim()) {
            end--;
        }
        const start = Math.max(0, end - maxLines);
        rendered = terminal.buffer.getLines(start, end - start, true).join('\n');
    } catch {
        rendered = '';
    }
    if (rendered.trim()) {
        return rendered;
    }
    // A hidden (never opened) preview terminal has an empty xterm buffer: its output is only held
    // as raw text until the widget opens. Quote that instead of reporting no output at all.
    return hasQaapUnrenderedOutput(terminal) ? lastDevOutputLines(terminal.qaapUnrenderedOutput, maxLines) : '';
}

/**
 * Longest wait, after the backend reported a dev process exit, for the terminal to deliver the rest of
 * its output. The exit notification and the output travel on different channels, so a process that
 * dies within a second of starting is often reported before any of its output arrived.
 */
export const DEV_EXIT_OUTPUT_SETTLE_MS = 1500;

/**
 * Resolves once a terminal whose process exited has received all of its output: Theia disposes the
 * widget (`onTerminalDidClose`) only after the output connection closed and pending writes drained.
 * Bounded by `timeoutMs`, so an attached or restored terminal that stays open never blocks the report.
 */
export function waitForDevExitOutput(
    terminal: { readonly isDisposed: boolean; readonly onTerminalDidClose: Event<unknown> },
    timeoutMs: number = DEV_EXIT_OUTPUT_SETTLE_MS,
): Promise<void> {
    if (terminal.isDisposed) {
        return Promise.resolve();
    }
    return new Promise<void>(resolve => {
        let settled = false;
        let listener: Disposable | undefined;
        const finish = (): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            listener?.dispose();
            resolve();
        };
        const timer = setTimeout(finish, timeoutMs);
        try {
            listener = terminal.onTerminalDidClose(() => finish());
        } catch {
            finish();
        }
        if (settled) {
            listener?.dispose();
        }
    });
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
