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
    /**
     * Background work (auth probes, `--version` checks, model listings): run under `nice` so the CPU the tenant's
     * 1-CPU quota leaves goes to the backend's event loop first (see {@link withLowCpuPriority}).
     */
    readonly lowPriority?: boolean;
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
    const command = options.lowPriority && !options.shell ? withLowCpuPriority(file, args) : { file, args: [...args] };
    const wrappedByNice = command.file !== file;
    const child = spawn(command.file, command.args, {
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
        if (wrappedByNice && !signal && !killedByDeadline && (code === NICE_COMMAND_NOT_FOUND || code === NICE_COMMAND_NOT_EXECUTABLE)) {
            // `nice` could not start the command: report it as the spawn error it was without the wrapper, so a missing
            // CLI stays "could not run" (an auth probe reads `unknown`), never an exit status the command answered.
            const errno = code === NICE_COMMAND_NOT_FOUND ? 'ENOENT' : 'EACCES';
            finish(Object.assign(new Error(`spawn ${file} ${errno}`), { code: errno, killed: false }));
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

/** coreutils `nice`, when this host has it (every Qaap image does). */
const COREUTILS_NICE_PATHS = ['/usr/bin/nice', '/bin/nice'];

/** `nice` exit statuses for a command it could not find (127) or not run (126), as POSIX specifies. */
export const NICE_COMMAND_NOT_FOUND = 127;
export const NICE_COMMAND_NOT_EXECUTABLE = 126;

/** Niceness of Qaap's own background child processes. */
export const QAAP_BACKGROUND_CHILD_NICENESS = 10;

/**
 * Prefixes a background command with `nice -n 10`. A tenant backend has one CPU, and the CLIs it spawns for itself
 * (auth probes, `--version` checks, model listings, `npm` checks) took that quota from its event loop: on staging
 * (24 Nov 2026) the container was throttled in 62 % of its CPU periods and the backend stalled up to 9.3 s while its
 * children ran. The scheduler weighs the processes inside the container by niceness, so the backend now gets the CPU
 * first. Raising niceness needs no privilege (the tenant has no CAP_SYS_NICE); `nice` sets it before it execs the
 * command, so every wrapper (`timeout`, `setpriv`) and the CLI below it inherit it, also after a uid drop.
 * Never used for agent turns or the plugin host (user-facing work). Unchanged on Windows or without `nice`.
 */
export function withLowCpuPriority(file: string, args: readonly string[]): { file: string; args: string[] } {
    const niceBin = process.platform === 'win32' ? undefined : COREUTILS_NICE_PATHS.find(candidate => fs.existsSync(candidate));
    if (!niceBin) {
        return { file, args: [...args] };
    }
    return { file: niceBin, args: ['-n', String(QAAP_BACKGROUND_CHILD_NICENESS), file, ...args] };
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
