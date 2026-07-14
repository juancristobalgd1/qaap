// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface AgentDiffRequestIdentity {
    disposed: boolean;
    requestPath: string;
    requestRoot: string;
    requestGeneration: number;
    requestSerial: number;
    currentRoot: string | undefined;
    currentGeneration: number;
    latestSerial: number | undefined;
    currentPaths: readonly string[];
}

/** Pure request guard used by the accordion to reject stale project/file responses. */
export function isCurrentAgentDiffRequest(identity: AgentDiffRequestIdentity): boolean {
    return !identity.disposed
        && identity.requestRoot === identity.currentRoot
        && identity.requestGeneration === identity.currentGeneration
        && identity.requestSerial === identity.latestSerial
        && identity.currentPaths.includes(identity.requestPath);
}
