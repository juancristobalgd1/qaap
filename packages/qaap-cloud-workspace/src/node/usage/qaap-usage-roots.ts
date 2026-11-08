// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';

/** Where each agent CLI keeps its local logs. Resolved from the backend's home directory and CLI overrides. */
export interface QaapUsageRoots {
    claudeConfigDir: string;
    claudeProjects: string;
    codexSessions: string;
    piSessions: string;
    opencodeMessages: string;
    opencodeParts: string;
    grokSessions: string;
    copilotDatabase: string;
}

export namespace QaapUsageRoots {

    export function resolve(env: NodeJS.ProcessEnv, homeDir: string): QaapUsageRoots {
        const claudeConfig = nonEmpty(env.CLAUDE_CONFIG_DIR) ?? path.join(homeDir, '.claude');
        const codexHome = nonEmpty(env.CODEX_HOME) ?? path.join(homeDir, '.codex');
        const piSessions = nonEmpty(env.PI_CODING_AGENT_SESSION_DIR) ?? path.join(homeDir, '.pi', 'agent', 'sessions');
        const dataHome = nonEmpty(env.XDG_DATA_HOME) ?? path.join(homeDir, '.local', 'share');
        const openCodeStorage = path.join(dataHome, 'opencode', 'storage');
        return {
            claudeConfigDir: claudeConfig,
            claudeProjects: path.join(claudeConfig, 'projects'),
            codexSessions: path.join(codexHome, 'sessions'),
            piSessions,
            opencodeMessages: path.join(openCodeStorage, 'message'),
            opencodeParts: path.join(openCodeStorage, 'part'),
            grokSessions: path.join(homeDir, '.grok', 'sessions'),
            copilotDatabase: path.join(homeDir, '.copilot', 'session-store.db'),
        };
    }

    function nonEmpty(value: string | undefined): string | undefined {
        const trimmed = value?.trim();
        return trimmed ? trimmed : undefined;
    }
}
