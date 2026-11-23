// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';

/** Options of {@link execFileKillingGroup}. */
export interface QaapExecFileGroupOptions {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    /** Deadline after which the whole process group is killed (SIGKILL). */
    readonly timeoutMs: number;
    /** Largest stdout or stderr kept, in characters; the rest is dropped. Default 1 MiB. */
    readonly maxBuffer?: number;
    /** Windows `.cmd` shims need a shell. */
    readonly shell?: boolean;
    readonly windowsHide?: boolean;
}

/** Why {@link execFileKillingGroup} reports a failure: a non-zero exit, a signal, or a spawn error. */
export interface QaapExecFileGroupError extends Error {
    readonly code?: number | string;
    readonly signal?: NodeJS.Signals;
    /** The deadline killed the process group. */
    readonly killed?: boolean;
}

const DEFAULT_MAX_BUFFER = 1024 * 1024;

/**
 * Runs a command like `execFile`, but its deadline kills the whole process tree, not only the child.
 *
 * `execFile`'s own `timeout` signals the child it spawned, and `execFile` does not forward `detached`
 * to `spawn`. A probe or a model listing is usually a wrapper (`sh -c …`, an npm shim, `setpriv`,
 * `systemd-run`) around the real CLI, so on a deadline the wrapper died and the CLI
 * (`claude auth status`, `agy models`) kept running. It also kept the pipes open, so `execFile`
 * never called back. On a busy, small backend those survivors piled up by the dozen (staging,
 * 23 Nov 2026: 10 `claude auth status` and 6 `agy models` alive for minutes, memory at its limit).
 *
 * On POSIX the child leads its own process group and the deadline kills the group. On Windows (no
 * process groups here) it falls back to killing the child. The callback runs exactly once.
 */
export function execFileKillingGroup(
    file: string,
    args: readonly string[],
    options: QaapExecFileGroupOptions,
    callback: (error: QaapExecFileGroupError | null, stdout: string, stderr: string) => void,
): ChildProcess {
    const posix = process.platform !== 'win32';
    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    let stdout = '';
    let stderr = '';
    let killedByDeadline = false;
    let done = false;
    const finish = (error: QaapExecFileGroupError | null): void => {
        if (done) {
            return;
        }
        done = true;
        clearTimeout(timer);
        callback(error, stdout, stderr);
    };
    const child = spawn(file, [...args], {
        cwd: options.cwd,
        env: options.env,
        shell: options.shell,
        windowsHide: options.windowsHide ?? true,
        detached: posix,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
        stdout = stdout.length < maxBuffer ? (stdout + chunk).slice(0, maxBuffer) : stdout;
    });
    child.stderr?.on('data', (chunk: string) => {
        stderr = stderr.length < maxBuffer ? (stderr + chunk).slice(0, maxBuffer) : stderr;
    });
    child.on('error', error => finish(Object.assign(error, { killed: killedByDeadline })));
    child.on('close', (code, signal) => {
        if (code === 0 && !signal && !killedByDeadline) {
            finish(null);
            return;
        }
        const reason = signal ? `signal ${signal}` : `exit code ${code}`;
        finish(Object.assign(new Error(`${file} failed (${reason})`), {
            ...(typeof code === 'number' ? { code } : {}),
            ...(signal ? { signal } : {}),
            killed: killedByDeadline,
        }));
    });
    const timer = setTimeout(() => {
        killedByDeadline = true;
        killProcessGroup(child, posix);
    }, options.timeoutMs);
    timer.unref?.();
    return child;
}

/** Kills `child`'s process group (POSIX) or the child alone; a process that is already gone is ignored. */
export function killProcessGroup(child: ChildProcess, posix = process.platform !== 'win32'): void {
    if (posix && child.pid) {
        try {
            process.kill(-child.pid, 'SIGKILL');
            return;
        } catch {
            // The group is gone, or the child never became a leader: fall back to the child.
        }
    }
    try {
        child.kill('SIGKILL');
    } catch {
        // Already gone.
    }
}

/** GNU coreutils `timeout`, when this host has it (every Qaap image does; a dev Mac may not). */
const COREUTILS_TIMEOUT_PATHS = ['/usr/bin/timeout', '/bin/timeout'];

/**
 * Prefixes a command with `timeout -k 2 <seconds>` so the deadline is enforced by a process running as
 * the command's own user. In a tenant backend the CLI runs as the agent uid (setpriv) while the backend
 * is root without CAP_KILL, so `kill` from the backend fails with EPERM and a stuck `opencode auth list`
 * lived for minutes. `timeout` leads its own process group and signals all of it, then SIGKILLs it 2 s
 * later. Wrap before the uid drop (`wrapArgvForTenant`), so `timeout` itself runs as the agent.
 * Unchanged on Windows or without `timeout`.
 */
export function withSelfEnforcedDeadline(file: string, args: readonly string[], timeoutMs: number): { file: string; args: string[] } {
    const timeoutBin = process.platform === 'win32' ? undefined : COREUTILS_TIMEOUT_PATHS.find(candidate => fs.existsSync(candidate));
    if (!timeoutBin) {
        return { file, args: [...args] };
    }
    const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    return { file: timeoutBin, args: ['-k', '2', String(seconds), file, ...args] };
}
