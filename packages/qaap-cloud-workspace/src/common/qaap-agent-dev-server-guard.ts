// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isShellToolName } from '@theia/qaap-shared-core/lib/common/qaap-transcript-preview-offer';
import type { QaapQaiqPendingControlRequest } from './qaap-qaiq-stdio-approvals';

/**
 * Guard against agents launching long-lived dev servers through shell tools.
 *
 * Shell tool calls time out after ~30s, so a `pnpm dev` started there dies and breaks
 * the live preview. Qaap runs dev servers in a dedicated persistent terminal instead
 * (see `QaapProjectBootstrapService`); the agent only needs to report the expected port.
 */

/** `pnpm dev`, `npm start`, `yarn serve`, `bun run preview`, … */
const PACKAGE_MANAGER_DEV_RE = /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)\b/i;
/** Framework binaries at command position: `vite`, `npx next dev`, `nohup astro dev`, … */
const FRAMEWORK_BIN_RE = /(?:^|&&|\|\||;|\(\s*|\b(?:nohup|exec)\s+)\s*(?:npx\s+|bunx\s+)?(?:vite|next|nuxt|astro|remix|webpack-dev-server|react-scripts)\b/i;
/** One-shot subcommands that look like dev tooling but exit on their own. */
const ONE_SHOT_RE = /(?:\b(?:build|export|test|lint|typecheck|info|telemetry)\b|--version|--help)/i;
/** Qaap npm scripts that start a browser/electron dev server, whatever package manager or prefix invokes them. */
const QAAP_DEV_SCRIPT_RE = /\b(?:npm|pnpm|yarn|bun|npx|bunx)\b[^&|;\n]*?\b(?:qaap:local:browser[\w:-]*|start:browser[\w:-]*|start:electron)\b/i;
/** Execution of the Qaap browser restart/start scripts by any path (`node …/qaap-restart-browser.mjs`, `./…`, `sh …`). */
const QAAP_RESTART_SCRIPT_RE = /(?:\b(?:node|bun|sh|bash|zsh|exec|source)\s+|(?:^|[\s;&|(])\.\/)[^&|;\n]*\bqaap-(?:restart|start)-browser(?:\.mjs|\.js)?\b/i;
/** Detached launches: `nohup`, `setsid`, `disown`, or a single trailing/inline `&` (not `&&`, `>&`, `&>`). */
const DETACHED_LAUNCH_RE = /\b(?:nohup|setsid|disown)\b|(?<![>&])&(?![&>])/;
/** Server-ish words that make a detached launch a dev/serve process. */
const SERVER_WORD_RE = /\b(?:dev|start|serve|preview)\b|\b(?:vite|next|nuxt|astro|remix|webpack-dev-server|react-scripts)\b/i;

/** Splits a shell command into simple segments at `&&`, `||`, `;`, `|`, newlines and single `&`. */
function splitShellSegments(text: string): string[] {
    return text.split(/&&|\|\||;|\||\n|(?<![>&])&(?![&>])/).map(segment => segment.trim()).filter(segment => segment.length > 0);
}

/** True for shell commands that start a long-lived dev server (background variants included). */
export function isLongLivedDevServerShellCommand(command: string | undefined): boolean {
    const text = command?.trim();
    if (!text) {
        return false;
    }
    // Script/launcher invocations are never exempt: a one-shot word elsewhere in the command must not hide them.
    if (QAAP_DEV_SCRIPT_RE.test(text) || QAAP_RESTART_SCRIPT_RE.test(text)) {
        return true;
    }
    if (DETACHED_LAUNCH_RE.test(text) && SERVER_WORD_RE.test(text)) {
        return true;
    }
    // Evaluate each segment so `pnpm build && pnpm dev` is not exempted by the one-shot word of its first part.
    return splitShellSegments(text).some(segment => !ONE_SHOT_RE.test(segment)
        && (PACKAGE_MANAGER_DEV_RE.test(segment) || FRAMEWORK_BIN_RE.test(segment)));
}

/** Options for the dev-server deny message. */
export interface DevServerShellDenyOptions {
    /**
     * Port of the live preview claim Qaap already holds for this project (the registry's reserved
     * port, not a port the agent guesses from `.qaap/preview.json` or prose). When known, the
     * agent is told where the app really runs instead of being asked to invent a port.
     */
    readonly reservedPort?: number;
}

/** Deny guidance sent back to the agent so it self-corrects instead of retrying. */
export function buildDevServerShellDenyMessage(options: DevServerShellDenyOptions = {}): string {
    const reservedPort = options.reservedPort;
    const head = 'Blocked by Qaap: do not start dev servers from shell tools — they time out after ~30s and kill the live preview. ';
    const serverLine = reservedPort !== undefined
        ? `Qaap's preview owns this project's dev server, reserved on port ${reservedPort} (see the Preview tab). Do not start another server, and do not report any other port: `
            + `when you describe the app, say that it is served by Qaap's Preview on port ${reservedPort}. `
        : 'Qaap runs the dev server in a dedicated terminal with hot reload. '
            + 'Do not guess a port: the Preview tab reports the real one. ';
    return head
        + serverLine
        + 'Run only one-shot commands (install, build, typecheck, test). '
        + 'Confirm dependencies are installed; Qaap starts the server only from a detected entry point or .qaap/preview.json, '
        + 'so if none exists, report that instead of promising a preview.';
}

/**
 * Returns the deny message when a pending QAIQ `can_use_tool` request is a shell tool
 * launching a long-lived dev server; `undefined` means the request should proceed
 * through the normal approval flow.
 */
export function findQaiqDevServerGuardDenial(request: QaapQaiqPendingControlRequest,
    options: DevServerShellDenyOptions = {}): string | undefined {
    if (!isShellToolName(request.toolName)) {
        return undefined;
    }
    const command = typeof request.toolInput?.command === 'string' ? request.toolInput.command : undefined;
    return isLongLivedDevServerShellCommand(command) ? buildDevServerShellDenyMessage(options) : undefined;
}
