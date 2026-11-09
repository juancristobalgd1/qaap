// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapUsageRoots } from '../usage/qaap-usage-roots';

/** How a turn resumes an imported CLI session, once the session's log was found where that CLI will look. */
export type QaapNativeResumePlan =
    | { readonly kind: 'claude'; readonly sessionId: string }
    /** `rollout` is copied into the per-task Codex home (gate overlay) and written back when the turn ends. */
    | { readonly kind: 'codex'; readonly sessionId: string; readonly rollout: string; readonly codexSessionsRoot: string };

/**
 * Decides whether a turn can really resume the CLI session it was asked to resume. When it cannot (the log
 * is gone, or the agent runs with another home than the one the session was imported from) the caller
 * falls back to the replayed-history prompt, so a turn never runs without its context.
 * See `doc/qaap-external-session-import.md`.
 */
export namespace QaapExternalNativeResume {

    export interface Options {
        readonly agentId: string | undefined;
        readonly sessionId: string;
        readonly cwd: string;
        /** The environment the agent process gets (its `HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`). */
        readonly agentEnv: NodeJS.ProcessEnv;
        /** True when Codex runs in a per-task gate overlay home that this process can write back from. */
        readonly codexOverlayWritable: boolean;
        /** True when Codex runs in a gate overlay at all; then the agent's own Codex home is never read. */
        readonly codexUsesOverlay: boolean;
        /** Roots the session was imported from (the backend's own home). Overridable in tests. */
        readonly roots?: QaapUsageRoots;
    }

    export function plan(options: Options): QaapNativeResumePlan | undefined {
        const { sessionId, cwd, agentEnv } = options;
        if (!/^[A-Za-z0-9_.-]{1,128}$/.test(sessionId)) {
            return undefined;
        }
        const roots = options.roots ?? QaapUsageRoots.resolve(process.env, os.homedir());
        const agent = options.agentId?.trim().toLowerCase();
        if (agent === 'claude') {
            const file = path.join(roots.claudeProjects, path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'), `${sessionId}.jsonl`);
            const agentHome = agentEnv.HOME?.trim() || os.homedir();
            const agentConfig = agentEnv.CLAUDE_CONFIG_DIR?.trim() || path.join(agentHome, '.claude');
            return fs.existsSync(file) && samePath(agentConfig, roots.claudeConfigDir) ? { kind: 'claude', sessionId } : undefined;
        }
        if (agent === 'codex') {
            const rollout = findCodexRollout(roots.codexSessions, sessionId);
            if (!rollout) {
                return undefined;
            }
            if (options.codexUsesOverlay) {
                return options.codexOverlayWritable
                    ? { kind: 'codex', sessionId, rollout, codexSessionsRoot: roots.codexSessions }
                    : undefined;
            }
            const agentHome = agentEnv.HOME?.trim() || os.homedir();
            const agentCodexHome = agentEnv.CODEX_HOME?.trim() || path.join(agentHome, '.codex');
            return samePath(path.join(agentCodexHome, 'sessions'), roots.codexSessions)
                ? { kind: 'codex', sessionId, rollout, codexSessionsRoot: roots.codexSessions }
                : undefined;
        }
        return undefined;
    }

    /** `rollout-<time>-<id>.jsonl` anywhere under the Codex sessions tree. */
    export function findCodexRollout(sessionsRoot: string, sessionId: string): string | undefined {
        const suffix = `${sessionId}.jsonl`;
        const visit = (dir: string, depth: number): string | undefined => {
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return undefined;
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith(suffix)) {
                    return full;
                }
                if (entry.isDirectory() && depth < 4) {
                    const found = visit(full, depth + 1);
                    if (found) {
                        return found;
                    }
                }
            }
            return undefined;
        };
        return visit(sessionsRoot, 0);
    }

    function samePath(a: string, b: string): boolean {
        const normalize = (value: string): string => {
            const resolved = path.resolve(value);
            try {
                return fs.realpathSync(resolved);
            } catch {
                return resolved;
            }
        };
        return normalize(a) === normalize(b);
    }
}
