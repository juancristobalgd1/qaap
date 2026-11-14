// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Token of the line the Connect wrapper prints when the login command ends. The shell echo of
 * the wrapper contains the token followed by `$?`, never by digits, so only the real exit matches.
 */
export const QAAP_AGENT_LOGIN_EXIT_TOKEN = 'QAAP_LOGIN_EXIT';
const EXIT_MARKER_RE = new RegExp(`${QAAP_AGENT_LOGIN_EXIT_TOKEN}:(\\d+)`);
/** Wide enough that Ink-based CLIs never hard-wrap an OAuth URL across lines. */
const LOGIN_TERMINAL_COLUMNS = 500;
/** Clack prompts (OpenCode) size their option lists from the rows; a 0-row PTY renders none. */
const LOGIN_TERMINAL_ROWS = 50;

export interface QaapAgentLoginShellOptions {
    /** Per-user harness install directory (`harness-status.cliBinDirectory`), prepended to PATH. */
    readonly cliBinDirectory?: string;
    readonly platform?: string;
    /** Environment variables exported for this login command only (names are fixed by the caller). */
    readonly env?: Readonly<Record<string, string>>;
}

function quotePosix(value: string): string {
    return `'${value.replace(/'/g, '\'\\\'\'')}'`;
}

function quotePowerShell(value: string): string {
    return `'${value.replace(/'/g, '\'\'')}'`;
}

/**
 * Wrap a login command for the hidden Connect terminal: widen the PTY, put the per-user harness
 * installs on PATH, and print an exit marker so the dialog learns when the CLI has ended (the
 * shell itself keeps running, so the terminal's own exit status never fires).
 */
export function buildAgentLoginShellCommand(command: string, options: QaapAgentLoginShellOptions = {}): string {
    const binDirectory = options.cliBinDirectory?.trim();
    const envEntries = Object.entries(options.env ?? {});
    if (options.platform === 'win32') {
        const powerShellPathSetup = binDirectory ? `$env:PATH = ${quotePowerShell(binDirectory)} + ';' + $env:PATH; ` : '';
        const powerShellEnvSetup = envEntries.map(([name, value]) => `$env:${name} = ${quotePowerShell(value)}; `).join('');
        return `${powerShellPathSetup}${powerShellEnvSetup}${command}; echo "${QAAP_AGENT_LOGIN_EXIT_TOKEN}:$LASTEXITCODE"`;
    }
    const pathSetup = binDirectory ? `PATH=${quotePosix(binDirectory)}:"$PATH"; export PATH; ` : '';
    const envSetup = envEntries.map(([name, value]) => `export ${name}=${quotePosix(value)}; `).join('');
    return `stty cols ${LOGIN_TERMINAL_COLUMNS} rows ${LOGIN_TERMINAL_ROWS} 2>/dev/null; ${pathSetup}${envSetup}${command}; echo "${QAAP_AGENT_LOGIN_EXIT_TOKEN}:$?"`;
}

/**
 * Largest piece of a login command written to the PTY at once. macOS drops terminal input past
 * its 1024-byte queue (TTYHOG): a longer line written in one go loses its tail and its Enter, so
 * the shell never runs it (the Gemini CLI Connect command is ~1300 bytes). Linux allows 4096.
 */
export const QAAP_AGENT_LOGIN_INPUT_CHUNK_BYTES = 512;
/** Commands up to this size are written at once (well under the 1024-byte macOS queue). */
export const QAAP_AGENT_LOGIN_SINGLE_WRITE_MAX_BYTES = 900;

/**
 * Splits a login command into PTY writes of at most {@link QAAP_AGENT_LOGIN_INPUT_CHUNK_BYTES}
 * UTF-8 bytes, never inside a UTF-16 surrogate pair, so the shell can drain each piece.
 */
export function splitAgentLoginShellInput(text: string, maxBytes: number = QAAP_AGENT_LOGIN_INPUT_CHUNK_BYTES): string[] {
    const chunks: string[] = [];
    const encoder = new TextEncoder();
    if (maxBytes === QAAP_AGENT_LOGIN_INPUT_CHUNK_BYTES && encoder.encode(text).length <= QAAP_AGENT_LOGIN_SINGLE_WRITE_MAX_BYTES) {
        return text ? [text] : [];
    }
    let current = '';
    let currentBytes = 0;
    for (const character of text) {
        const bytes = encoder.encode(character).length;
        if (current && currentBytes + bytes > maxBytes) {
            chunks.push(current);
            current = '';
            currentBytes = 0;
        }
        current += character;
        currentBytes += bytes;
    }
    if (current) {
        chunks.push(current);
    }
    return chunks;
}

/** Exit code of the wrapped login command, once it has ended. */
export function parseAgentLoginExitMarker(output: string): number | undefined {
    const match = EXIT_MARKER_RE.exec(output);
    return match ? Number(match[1]) : undefined;
}

/** Terminal output without the echoed wrapper line or the exit marker (the user never typed them). */
export function stripAgentLoginShellEcho(output: string): string {
    return output
        .split('\n')
        .filter(line => !line.includes(QAAP_AGENT_LOGIN_EXIT_TOKEN))
        .join('\n');
}
