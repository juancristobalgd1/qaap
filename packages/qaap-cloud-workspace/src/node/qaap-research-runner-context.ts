// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `QaapResearchRunner` and the `*Extracted` free functions in the
// `qaap-research-runner-{render2,streaming2}.ts` cluster. Each extracted function receives `this`
// (the runner) typed as `QaapResearchRunnerContext` instead of `any`. Only members actually
// referenced through `ctx.` across that cluster are listed here — see `qaap-research-runner.ts`,
// which `implements` this interface, for the real implementation of each member.
//
// `import type` throughout to avoid a runtime import cycle with the extracted modules.

import type { ResearchGoal, TerminationReason } from '@theia/qaap-mobile-shell/lib/common/qaap-research-goal';
import type { ResearchExperimentRecord } from '@theia/qaap-mobile-shell/lib/common/qaap-research-ledger';
import type { RealFileChange } from '@theia/qaap-mobile-shell/lib/common/qaap-research-realchange';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import type { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { QaapGenericCommandResult } from './qaap-agent-task-runner-constants';
import type { QaapResearchStore } from './qaap-research-store';
import type { QaapTenantSpawnService } from './qaap-tenant-spawn-service';

/** Options of {@link QaapResearchRunnerContext.runPropose}. */
export interface QaapResearchProposeOptions {
    readonly reminder?: string;
    readonly fingerprintRetried?: boolean;
    readonly noopRetried?: boolean;
}

/** Proposal the runner synthesizes from the round's diff when the agent omitted its JSON block. */
export interface QaapResearchFallbackProposal {
    readonly hypothesis: string;
    readonly symptom?: string;
    readonly lever?: string;
    readonly config: Record<string, unknown>;
}

/** Result of {@link QaapResearchRunnerContext.commitRoundChanges}. */
export interface QaapResearchRoundCommit {
    sha?: string;
    baselineSha?: string;
    adoptedAgentCommits?: number;
}

/**
 * Members of {@link QaapResearchRunner} that the `*Extracted` helper functions access via `ctx.`.
 */
export interface QaapResearchRunnerContext {

    // ─── Injected services ──────────────────────────────────────────────────
    readonly store: QaapResearchStore;
    readonly taskRunner: QaapAgentTaskRunner;
    readonly tenantSpawn: QaapTenantSpawnService;

    // ─── State ──────────────────────────────────────────────────────────────
    readonly activeExecutionId: Map<string, string>;
    readonly loopRunning: Set<string>;

    // ─── Loop / rounds ──────────────────────────────────────────────────────
    beginLedgerWrite(cwd: string, record: ResearchExperimentRecord): undefined | Promise<void>;
    ensureLoop(goalId: string): void;
    runLoop(goalId: string): Promise<void>;
    readRoundLedger(goal: ResearchGoal): ResearchExperimentRecord[];
    ensurePreflightPassed(goalId: string): Promise<boolean>;
    recordPreflightResult(goal: ResearchGoal, failureNote: string | undefined): Promise<void>;
    terminate(goal: ResearchGoal, reason: TerminationReason): void;
    isCancelled(goalId: string): boolean;
    startNewRound(goal: ResearchGoal, round: number): Promise<void>;
    resumeRound(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void>;

    // ─── Phases ─────────────────────────────────────────────────────────────
    runPropose(goal: ResearchGoal, record: ResearchExperimentRecord, options: QaapResearchProposeOptions): Promise<void>;
    synthesizeFallbackProposal(diffStat: string): QaapResearchFallbackProposal;
    roundDiffStat(cwd: string): string;
    collectRealFileChanges(cwd: string): RealFileChange[];
    pushRealFileChange(changes: RealFileChange[], cwd: string, rawPath: string, deleted: boolean): void;
    unquoteGitPath(rawPath: string): string;
    finishAsNoop(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void>;
    commitRound(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void>;
    commitRoundChanges(goal: ResearchGoal, record: ResearchExperimentRecord): QaapResearchRoundCommit;
    discardBrokenRound(goal: ResearchGoal, record: ResearchExperimentRecord, reason: string): Promise<void>;
    describeGateFailure(task: QaapAgentTask): string;
    runRunPhase(goal: ResearchGoal, record: ResearchExperimentRecord, isResume: boolean): Promise<void>;
    runMeasurePhase(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void>;
    finishAsInfraFailure(goal: ResearchGoal, record: ResearchExperimentRecord, reason: string, runAttempts: number | undefined): Promise<void>;
    revertRound(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void>;

    // ─── Helpers ────────────────────────────────────────────────────────────
    waitForTaskFinish(taskId: string): Promise<QaapAgentTask>;
    waitForTaskFinishOrTimeout(taskId: string, timeoutMs: number): Promise<QaapAgentTask | undefined>;
    appendNote(existing: string | undefined, note: string): string;
    describeCommandFailure(label: string, result: QaapGenericCommandResult): string;
    appendCommandOutput(reason: string, result: QaapGenericCommandResult): string;
    buildResearchCommandEnv(ownerLogin?: string): NodeJS.ProcessEnv;
    runGit(cwd: string, args: readonly string[]): { readonly stdout: string; readonly ok: boolean };
    shellQuote(value: string): string;
}
