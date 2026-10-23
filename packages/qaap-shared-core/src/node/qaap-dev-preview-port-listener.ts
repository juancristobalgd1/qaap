// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TCP_LISTEN_STATE = '0A';

/** Parses hex `local_address` from /proc/net/tcp into a port number. */
export function parseProcNetTcpLocalPort(localAddress: string): number | undefined {
    const colon = localAddress.lastIndexOf(':');
    if (colon < 0) {
        return undefined;
    }
    const parsed = Number.parseInt(localAddress.slice(colon + 1), 16);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : undefined;
}

/** Inodes of sockets in LISTEN state on `port` from a /proc/net/tcp{,6} table. */
export function extractListeningInodesForPort(procNetTable: string, port: number): Set<string> {
    const inodes = new Set<string>();
    for (const line of procNetTable.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('sl')) {
            continue;
        }
        const fields = trimmed.split(/\s+/);
        if (fields.length < 10 || fields[3] !== TCP_LISTEN_STATE) {
            continue;
        }
        const localPort = parseProcNetTcpLocalPort(fields[1]);
        if (localPort === port) {
            inodes.add(fields[9]);
        }
    }
    return inodes;
}

/** Resolves PIDs owning any of the given socket inodes via /proc process fd symlinks. */
export function findPidsForSocketInodes(inodes: ReadonlySet<string>): number[] {
    if (inodes.size === 0) {
        return [];
    }
    const pids = new Set<number>();
    let procEntries: string[];
    try {
        procEntries = fs.readdirSync('/proc');
    } catch {
        return [];
    }
    for (const entry of procEntries) {
        if (!/^\d+$/.test(entry)) {
            continue;
        }
        const pid = Number(entry);
        const fdDir = path.join('/proc', entry, 'fd');
        let fds: string[];
        try {
            fds = fs.readdirSync(fdDir);
        } catch {
            continue;
        }
        for (const fd of fds) {
            let target: string;
            try {
                target = fs.readlinkSync(path.join(fdDir, fd));
            } catch {
                continue;
            }
            const match = /^socket:\[(\d+)\]$/.exec(target);
            if (match && inodes.has(match[1])) {
                pids.add(pid);
                break;
            }
        }
    }
    return [...pids];
}

function readProcNetTable(filename: string): string | undefined {
    try {
        return fs.readFileSync(path.join('/proc/net', filename), 'utf8');
    } catch {
        return undefined;
    }
}

function findListeningPidsViaProc(port: number): number[] {
    const inodes = new Set<string>();
    for (const table of ['tcp', 'tcp6'] as const) {
        const content = readProcNetTable(table);
        if (content) {
            for (const inode of extractListeningInodesForPort(content, port)) {
                inodes.add(inode);
            }
        }
    }
    return findPidsForSocketInodes(inodes);
}

function findListeningPidsViaLsof(port: number): number[] {
    try {
        const output = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {
            encoding: 'utf8',
            timeout: 2000,
        }).trim();
        if (!output) {
            return [];
        }
        return output.split('\n')
            .map(line => Number(line.trim()))
            .filter(pid => Number.isFinite(pid) && pid > 0);
    } catch {
        return [];
    }
}

/** PIDs with a LISTEN socket on `port` (IPv4/IPv6). Empty on unsupported platforms. */
export function findListeningPidsOnPort(port: number): number[] {
    if (process.platform === 'win32' || !Number.isFinite(port) || port <= 0 || port > 65535) {
        return [];
    }
    const viaProc = findListeningPidsViaProc(port);
    if (viaProc.length > 0) {
        return viaProc;
    }
    return findListeningPidsViaLsof(port);
}

function readProcessCwd(pid: number): string | undefined {
    if (process.platform === 'linux') {
        try {
            return fs.readlinkSync(path.join('/proc', String(pid), 'cwd'));
        } catch {
            return undefined;
        }
    }
    try {
        const output = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
            encoding: 'utf8',
            timeout: 2000,
        });
        const line = output.split('\n').find(entry => entry.startsWith('n'));
        return line ? line.slice(1) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Working directories of every process listening on `port`. Empty when nothing listens or when
 * ANY listener's directory cannot be read: callers use it as ownership evidence, and evidence
 * about only some of the listeners is not evidence.
 */
export function findListeningProcessCwdsOnPort(port: number): string[] {
    const cwds: string[] = [];
    for (const pid of findListeningPidsOnPort(port)) {
        if (pid === process.pid) {
            // The backend listening on a sandbox forward is not evidence about the preview's owner.
            continue;
        }
        const cwd = readProcessCwd(pid);
        if (!cwd) {
            return [];
        }
        cwds.push(cwd);
    }
    return cwds;
}

function swallowEsrch(fn: () => void): void {
    try {
        fn();
    } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ESRCH') {
            // Best-effort cleanup; ignore permission errors and races.
        }
    }
}

/**
 * Process group id of `pid`, or undefined when it cannot be read. Linux reads /proc/<pid>/stat
 * (parsed after the last `)` because the command name may contain spaces); elsewhere `ps`.
 */
export function readProcessGroupId(pid: number): number | undefined {
    if (!Number.isInteger(pid) || pid <= 0) {
        return undefined;
    }
    if (process.platform === 'linux') {
        try {
            const stat = fs.readFileSync(path.join('/proc', String(pid), 'stat'), 'utf8');
            const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
            const pgid = Number(fields[2]);
            return Number.isInteger(pgid) && pgid > 0 ? pgid : undefined;
        } catch {
            return undefined;
        }
    }
    try {
        const output = execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
            encoding: 'utf8',
            timeout: 2000,
        }).trim();
        const pgid = Number(output);
        return Number.isInteger(pgid) && pgid > 0 ? pgid : undefined;
    } catch {
        return undefined;
    }
}

/**
 * True when signalling `pid` could hit this process: not a positive integer above 1 (0, 1, negatives
 * and NaN would address groups or every process), or this process itself.
 */
export function isSelfOrUnsafeSignalTarget(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 1) {
        return true;
    }
    return pid === process.pid;
}

/**
 * Whether `process.kill(-pid)` is safe: the group led by `pid` must be readable and must not contain
 * this process. Fail-safe: an unreadable process group is never signalled.
 */
export function canSignalProcessGroup(pid: number): boolean {
    if (isSelfOrUnsafeSignalTarget(pid)) {
        return false;
    }
    const ownGroup = readProcessGroupId(process.pid);
    const targetGroup = readProcessGroupId(pid);
    if (ownGroup === undefined || targetGroup === undefined) {
        return false;
    }
    return ownGroup !== pid && targetGroup !== ownGroup;
}

/**
 * SIGTERM the listener PID and its process group (`-pid`). Best-effort; never throws.
 * Used when superseding a terminal-spawned preview that has no recorded osProcessId.
 * Never signals this process: the sandbox forwards preview ports through the backend itself.
 */
export function terminateListenersOnPort(port: number): void {
    if (process.platform === 'win32') {
        return;
    }
    let refused = false;
    for (const pid of findListeningPidsOnPort(port)) {
        if (isSelfOrUnsafeSignalTarget(pid)) {
            refused = refused || pid === process.pid;
            continue;
        }
        swallowEsrch(() => process.kill(pid, 'SIGTERM'));
        if (canSignalProcessGroup(pid)) {
            swallowEsrch(() => process.kill(-pid, 'SIGTERM'));
        }
    }
    if (refused) {
        console.warn(`[qaap-preview] refusing to signal own process listening on port ${port}; the preview server lives elsewhere (sandbox forward)`);
    }
}
