// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ChildProcess, spawnSync } from 'child_process';

/** The OS identity an agent process runs as when the backend drops privileges. */
export interface AgentProcessIdentity {
    readonly uid: number;
    readonly gid?: number;
}

/**
 * `sent`: the signal was delivered. `gone`: no such process (ESRCH), so it has already exited.
 * `failed`: the signal could not be delivered and the process may still be running. Never treat `failed` as stopped.
 */
export type AgentProcessSignalOutcome = 'sent' | 'gone' | 'failed';

/** Exit codes of {@link AGENT_PROCESS_SIGNAL_SCRIPT}. */
const RELAY_EXIT_SENT = 0;
const RELAY_EXIT_GONE = 3;

/**
 * Runs as the agent uid: signals `target` (a pid, or `-pgid` for a group) and reports the outcome as an exit code.
 * The kernel enforces the boundary: the child can only signal what that uid may signal.
 */
export const AGENT_PROCESS_SIGNAL_SCRIPT = [
    "const fs=require('fs');",
    "const i=JSON.parse(fs.readFileSync(0,'utf8'));",
    'try{process.kill(i.target,i.signal);process.exit(' + RELAY_EXIT_SENT + ');}',
    "catch(e){process.exit(e&&e.code==='ESRCH'?" + RELAY_EXIT_GONE + ':1);}',
].join('');

function runSignalAsAgentIdentity(identity: AgentProcessIdentity, target: number, signal: NodeJS.Signals): AgentProcessSignalOutcome {
    try {
        const result = spawnSync(process.execPath, ['-e', AGENT_PROCESS_SIGNAL_SCRIPT], {
            uid: identity.uid, gid: identity.gid ?? identity.uid, cwd: '/',
            input: JSON.stringify({ target, signal }), timeout: 5000,
            env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stdio: ['pipe', 'ignore', 'pipe'],
        });
        if (result.status === RELAY_EXIT_SENT) {
            return 'sent';
        }
        if (result.status === RELAY_EXIT_GONE) {
            return 'gone';
        }
        console.warn(`[qaap-agent-process] relay as uid ${identity.uid} could not signal ${target}: ${String(result.stderr ?? result.error ?? 'no status').slice(0, 200)}`);
        return 'failed';
    } catch (error) {
        console.warn(`[qaap-agent-process] relay as uid ${identity.uid} threw: ${error instanceof Error ? error.message : String(error)}`);
        return 'failed';
    }
}

/** Seam for the agent-side signal relay; specs replace `run` to simulate the agent uid without root. */
export const agentProcessSignalRunner: {
    run: (identity: AgentProcessIdentity, target: number, signal: NodeJS.Signals) => AgentProcessSignalOutcome;
} = {
    run: runSignalAsAgentIdentity,
};

/** Identity each agent child was spawned with, so a later stop can relay the signal as that uid. */
const agentProcessIdentities = new WeakMap<ChildProcess, AgentProcessIdentity>();

/** Records the identity a child was spawned as. `undefined` (no privilege drop) records nothing. */
export function rememberAgentProcessIdentity(child: ChildProcess, identity: { uid?: number; gid?: number } | undefined): void {
    if (identity?.uid !== undefined) {
        agentProcessIdentities.set(child, { uid: identity.uid, gid: identity.gid });
    }
}

export function agentProcessIdentityOf(child: ChildProcess): AgentProcessIdentity | undefined {
    return agentProcessIdentities.get(child);
}

/**
 * Delivers `signal` to `target` (a pid, or `-pgid` for a group). EPERM from a root backend without CAP_KILL is
 * retried by a child that runs as the agent `identity`; if that also fails the result is `failed`.
 * Refuses pid 0, 1, this process, and anything that is not an integer: those are never agent processes.
 */
export function signalAgentProcess(target: number, signal: NodeJS.Signals, identity?: AgentProcessIdentity): AgentProcessSignalOutcome {
    const pid = Math.abs(target);
    if (!Number.isInteger(target) || pid <= 1 || pid === process.pid) {
        console.warn(`[qaap-agent-process] refusing to signal ${target}: not an agent process`);
        return 'failed';
    }
    try {
        process.kill(target, signal);
        return 'sent';
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ESRCH') {
            return 'gone';
        }
        const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
        if (code !== 'EPERM' || !identity || identity.uid === currentUid) {
            return 'failed';
        }
        return agentProcessSignalRunner.run(identity, target, signal);
    }
}

/**
 * Signals the process group led by `child` and then, when the group is already gone, the leader itself.
 * `sent` once the group got the signal; `failed` when the group could not be reached, even if the leader was.
 */
export function signalAgentProcessTree(child: ChildProcess, signal: NodeJS.Signals): AgentProcessSignalOutcome {
    const pid = child.pid;
    if (!pid) {
        return 'gone';
    }
    const identity = agentProcessIdentityOf(child);
    const group = signalAgentProcess(-pid, signal, identity);
    if (group === 'sent') {
        return 'sent';
    }
    // ESRCH on the group: it never became a leader or already exited, so the leader still needs the signal.
    const leader = signalAgentProcess(pid, signal, identity);
    return group === 'gone' ? leader : 'failed';
}
