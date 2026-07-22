// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable, Emitter, Event, nls } from '@theia/core';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    isValidQaapJsonPointer,
    replaceQaapJsonPointer,
    resolveQaapJsonPointer,
} from '../common/qaap-json-pointer';
import {
    didQaapJobSucceed,
    isQaapJobFinished,
    QaapCreateJobGraphNode,
} from '../common/qaap-job';
import {
    isQaapJobLoopFinished,
    QAAP_JOB_LOOP_CONDITION_OPERATORS,
    QaapCreateJobLoopGraphNode,
    QaapCreateJobLoopRequest,
    QaapCreateJobLoopResult,
    QaapJobLoop,
    QaapJobLoopCondition,
    QaapJobLoopConditionOperator,
    QaapJobLoopEvent,
    QaapJobLoopEventType,
    QaapJobLoopInputBinding,
    QaapJobLoopMetrics,
    QaapJobLoopRound,
    QaapJobLoopRoundDetail,
    QaapJobLoopTerminationReason,
} from '../common/qaap-job-loop';
import { QaapJobRuntime } from './qaap-job-runtime';
import { writeJsonAtomic } from './qaap-write-json-atomic';

const STORE_MODE = 0o700;
const INDEX_MODE = 0o600;
const DEFAULT_MAX_ITERATIONS = 10;
const MAX_ITERATIONS = 100;
const DEFAULT_MAX_DURATION_MS = 60 * 60 * 1000;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_JOBS = 512;
const DEFAULT_MAX_ACTIVE_PER_USER = 4;
const MAX_GRAPH_NODES = 128;
const MAX_CONDITION_CHARS = 64 * 1024;
const MAX_BINDINGS_PER_NODE = 32;
const MAX_DURABLE_EVENTS = 512;

interface NormalizedLoopCondition extends QaapJobLoopCondition {
    readonly source: 'result' | 'job';
    readonly pointer: string;
}

interface NormalizedLoopInputBinding extends QaapJobLoopInputBinding {
    readonly from: {
        readonly nodeKey: string;
        readonly source: 'result' | 'job';
        readonly pointer: string;
    };
}

interface NormalizedLoopGraphNode extends QaapCreateJobLoopGraphNode {
    readonly bindings: readonly NormalizedLoopInputBinding[];
}

interface NormalizedLoopRequest {
    readonly title: string;
    readonly graph: { readonly nodes: readonly NormalizedLoopGraphNode[] };
    readonly until: NormalizedLoopCondition;
    readonly maxIterations: number;
    readonly maxDurationMs: number;
    readonly idempotencyKey?: string;
}

interface PersistedLoopRecord {
    loop: QaapJobLoop;
    readonly request: NormalizedLoopRequest;
    readonly fingerprint: string;
}

interface PersistedLoopIndex {
    readonly version: 2;
    readonly loops: readonly PersistedLoopRecord[];
    readonly eventSequence: number;
    readonly events: readonly QaapJobLoopEvent[];
}

interface LegacyPersistedLoopIndex extends Pick<PersistedLoopIndex, 'loops'> {
    readonly version: 1;
}

export class QaapJobLoopRequestError extends Error { }
export class QaapJobLoopConflictError extends Error { }
export class QaapJobLoopBindingError extends Error { }

/**
 * Durable loop controller over QaapJobRuntime graphs.
 *
 * The controller never executes work itself. Each round is an ordinary persisted job graph, so
 * scheduler quotas, workspace leases, retries and tenant isolation remain centralized in the job
 * runtime. A loop advances only after every job in its current graph has reached a terminal state.
 */
@injectable()
export class QaapJobLoopEngine {

    @inject(QaapJobRuntime)
    protected readonly runtime: QaapJobRuntime;

    protected readonly records = new Map<string, PersistedLoopRecord>();
    protected readonly idempotencyIndex = new Map<string, string>();
    protected readonly deadlineTimers = new Map<string, NodeJS.Timeout>();
    protected readonly loopChains = new Map<string, Promise<unknown>>();
    protected events: QaapJobLoopEvent[] = [];
    protected eventSequence = 0;
    protected persistChain: Promise<void> = Promise.resolve();
    protected createChain: Promise<void> = Promise.resolve();
    protected jobListener: Disposable | undefined;
    protected stopping = false;

    protected readonly onDidChangeLoopEmitter = new Emitter<QaapJobLoopEvent>();
    readonly onDidChangeLoop: Event<QaapJobLoopEvent> = this.onDidChangeLoopEmitter.event;

    @postConstruct()
    protected init(): void {
        let stateIsWritable = true;
        try {
            fs.mkdirSync(this.storeDirectory(), { recursive: true, mode: STORE_MODE });
            fs.chmodSync(this.storeDirectory(), STORE_MODE);
            const raw = fs.readFileSync(this.indexPath(), 'utf8');
            this.restorePersistedIndex(JSON.parse(raw));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                stateIsWritable = false;
                console.warn('[qaap-job-loops] failed to restore loop index:', error);
            }
        }
        this.jobListener = this.runtime.onDidChangeJob(event => {
            if (event.type !== 'output' && isQaapJobFinished(event.job.state)) {
                this.reconcileLoopsContaining(event.job.id);
            }
        });
        for (const record of this.records.values()) {
            if (!isQaapJobLoopFinished(record.loop.state)) {
                this.scheduleDeadline(record);
                this.scheduleReconcile(record.loop.id);
            }
        }
        if (stateIsWritable) {
            void this.persist();
        }
    }

    create(request: QaapCreateJobLoopRequest, ownerLogin?: string): Promise<QaapCreateJobLoopResult> {
        const owner = ownerLogin?.trim() || undefined;
        const operation = this.createChain
            .catch(() => undefined)
            .then(() => this.createInternal(request, owner));
        this.createChain = operation.then(() => undefined, () => undefined);
        return operation;
    }

    /**
     * Validate a reusable definition without creating durable state or scheduling work.
     *
     * Template endpoints use the same authority as live loop creation so graph limits,
     * conditions, bindings and job budgets cannot drift between save and run paths.
     */
    validate(request: QaapCreateJobLoopRequest): void {
        this.normalizeRequest(request);
    }

    list(ownerLogin?: string): QaapJobLoop[] {
        const owner = ownerLogin?.trim() || undefined;
        const loops: QaapJobLoop[] = [];
        for (const record of this.records.values()) {
            if (record.loop.ownerLogin === owner) {
                loops.push(record.loop);
            }
        }
        return loops.sort((left, right) => right.createdAt - left.createdAt);
    }

    get(id: string): QaapJobLoop | undefined {
        return this.records.get(id)?.loop;
    }

    getMetrics(ownerLogin?: string): QaapJobLoopMetrics {
        const loops = this.list(ownerLogin);
        let active = 0;
        let succeeded = 0;
        let failed = 0;
        let cancelled = 0;
        let budgetExhausted = 0;
        let roundsScheduled = 0;
        let jobsScheduled = 0;
        for (const loop of loops) {
            roundsScheduled += loop.iteration;
            jobsScheduled += loop.jobsScheduled;
            switch (loop.state) {
                case 'running': active++; break;
                case 'succeeded': succeeded++; break;
                case 'failed': failed++; break;
                case 'cancelled': cancelled++; break;
                case 'budget_exhausted': budgetExhausted++; break;
            }
        }
        return {
            generatedAt: Date.now(),
            total: loops.length,
            active,
            succeeded,
            failed,
            cancelled,
            budgetExhausted,
            roundsScheduled,
            jobsScheduled,
        };
    }

    getRoundDetail(id: string, iteration: number): QaapJobLoopRoundDetail | undefined {
        const record = this.records.get(id);
        const round = record?.loop.rounds.find(candidate => candidate.iteration === iteration);
        if (!record || !round) {
            return undefined;
        }
        const detail = this.runtime.getGraph(round.graphId);
        return {
            loopId: id,
            round,
            graph: detail?.graph,
            jobs: detail?.jobs ?? {},
        };
    }

    eventsSince(ownerLogin: string | undefined, afterSequence = 0): QaapJobLoopEvent[] {
        const owner = ownerLogin?.trim() || undefined;
        return this.events.filter(event => event.ownerLogin === owner && event.sequence > afterSequence);
    }

    currentSequence(): number {
        return this.eventSequence;
    }

    async cancel(id: string, ownerLogin?: string): Promise<QaapJobLoop | undefined> {
        const owner = ownerLogin?.trim() || undefined;
        return this.enqueueLoop(id, async () => {
            const record = this.records.get(id);
            if (!record || record.loop.ownerLogin !== owner) {
                return undefined;
            }
            if (isQaapJobLoopFinished(record.loop.state)) {
                return record.loop;
            }
            this.finishLoop(record, 'cancelled', 'cancelled');
            this.cancelCurrentGraph(record);
            await this.persist();
            return record.loop;
        });
    }

    /** Stop loop bookkeeping without cancelling durable graphs; the next backend resumes them. */
    async shutdown(): Promise<void> {
        this.stopping = true;
        this.jobListener?.dispose();
        this.jobListener = undefined;
        for (const timer of this.deadlineTimers.values()) {
            clearTimeout(timer);
        }
        this.deadlineTimers.clear();
        await this.createChain.catch(() => undefined);
        await Promise.all([...this.loopChains.values()].map(chain => chain.catch(() => undefined)));
        await this.persist();
        this.onDidChangeLoopEmitter.dispose();
    }

    protected async createInternal(request: QaapCreateJobLoopRequest, ownerLogin?: string): Promise<QaapCreateJobLoopResult> {
        if (this.stopping) {
            throw new QaapJobLoopRequestError(nls.localize('qaap/jobLoops/stopping', 'The job loop engine is stopping.'));
        }
        const normalized = this.normalizeRequest(request);
        const fingerprint = this.stableJson(normalized);
        if (normalized.idempotencyKey) {
            const indexKey = this.ownerIdempotencyKey(ownerLogin, normalized.idempotencyKey);
            const existingId = this.idempotencyIndex.get(indexKey);
            const existing = existingId ? this.records.get(existingId) : undefined;
            if (existing) {
                if (existing.fingerprint !== fingerprint) {
                    throw new QaapJobLoopConflictError(nls.localize(
                        'qaap/jobLoops/idempotencyConflict',
                        'This idempotency key was already used for a different job loop.',
                    ));
                }
                return { loop: existing.loop, created: false };
            }
        }
        const activeForOwner = [...this.records.values()].filter(
            record => record.loop.ownerLogin === ownerLogin && record.loop.state === 'running',
        ).length;
        if (activeForOwner >= this.maxActiveLoopsPerOwner()) {
            throw new QaapJobLoopRequestError(nls.localize(
                'qaap/jobLoops/activeLimit',
                'The maximum number of active job loops for this user has been reached.',
            ));
        }
        const createdAt = Date.now();
        const id = randomUUID();
        const maxJobs = normalized.graph.nodes.length * normalized.maxIterations;
        const loop: QaapJobLoop = {
            id,
            title: normalized.title,
            state: 'running',
            ownerLogin,
            createdAt,
            startedAt: createdAt,
            iteration: 0,
            maxIterations: normalized.maxIterations,
            maxDurationMs: normalized.maxDurationMs,
            maxJobs,
            jobsScheduled: 0,
            until: normalized.until,
            rounds: [],
            idempotencyKey: normalized.idempotencyKey,
        };
        const record: PersistedLoopRecord = { loop, request: normalized, fingerprint };
        this.records.set(id, record);
        if (normalized.idempotencyKey) {
            this.idempotencyIndex.set(this.ownerIdempotencyKey(ownerLogin, normalized.idempotencyKey), id);
        }
        this.fireLoopEvent(record, 'created');
        await this.persist();
        try {
            await this.startNextRound(record);
        } catch (error) {
            this.clearDeadline(id);
            this.records.delete(id);
            if (normalized.idempotencyKey) {
                this.idempotencyIndex.delete(this.ownerIdempotencyKey(ownerLogin, normalized.idempotencyKey));
            }
            this.events = this.events.filter(event => event.loopId !== id);
            await this.persist();
            throw error;
        }
        try {
            await this.enqueueLoop(record.loop.id, () => this.reconcile(record.loop.id));
        } catch (error) {
            if (record.loop.state === 'running') {
                this.finishLoop(record, 'failed', error instanceof QaapJobLoopBindingError
                    ? 'binding_missing'
                    : 'graph_creation_failed');
                await this.persist();
            }
            if (!(error instanceof QaapJobLoopBindingError)) {
                console.warn('[qaap-job-loops] failed to reconcile newly created loop:', error);
            }
        }
        return { loop: record.loop, created: true };
    }

    protected normalizeRequest(request: QaapCreateJobLoopRequest): NormalizedLoopRequest {
        if (!request || typeof request !== 'object' || Array.isArray(request)) {
            throw new QaapJobLoopRequestError(nls.localize('qaap/jobLoops/invalidRequest', 'Invalid job loop request.'));
        }
        const nodes = request.graph?.nodes;
        if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > MAX_GRAPH_NODES) {
            throw new QaapJobLoopRequestError(nls.localize(
                'qaap/jobLoops/invalidGraphSize',
                'A loop graph must contain between 1 and {0} nodes.',
                String(MAX_GRAPH_NODES),
            ));
        }
        const maxIterations = request.maxIterations ?? DEFAULT_MAX_ITERATIONS;
        if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_ITERATIONS) {
            throw new QaapJobLoopRequestError(nls.localize(
                'qaap/jobLoops/invalidIterations',
                'Loop iterations must be between 1 and {0}.',
                String(MAX_ITERATIONS),
            ));
        }
        const maxDurationMs = request.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
        if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < MIN_DURATION_MS || maxDurationMs > MAX_DURATION_MS) {
            throw new QaapJobLoopRequestError(nls.localize(
                'qaap/jobLoops/invalidDuration',
                'Loop duration must be between 1 second and 7 days.',
            ));
        }
        const totalJobs = nodes.length * maxIterations;
        if (!Number.isSafeInteger(totalJobs) || totalJobs > this.maxJobsPerLoop()) {
            throw new QaapJobLoopRequestError(nls.localize(
                'qaap/jobLoops/jobBudgetExceeded',
                'The loop graph and iteration count exceed the maximum job budget of {0}.',
                String(this.maxJobsPerLoop()),
            ));
        }
        const nodeKeys = new Set(nodes.map(node => typeof node?.key === 'string' ? node.key.trim() : ''));
        const until = this.normalizeCondition(request.until, nodeKeys);
        const idempotencyKey = this.normalizeIdempotencyKey(request.idempotencyKey);
        const requestedTitle = typeof request.title === 'string' ? request.title.trim() : '';
        const graphNodes = nodes.map(node => ({
            key: node.key,
            request: { ...node.request },
            dependsOn: node.dependsOn ? [...node.dependsOn] : undefined,
            bindings: this.normalizeBindings(node, nodeKeys),
        }));
        return {
            title: (requestedTitle || nls.localize('qaap/jobLoops/defaultTitle', 'Job loop')).slice(0, 200),
            graph: { nodes: graphNodes },
            until,
            maxIterations,
            maxDurationMs,
            idempotencyKey,
        };
    }

    protected normalizeCondition(value: QaapJobLoopCondition, nodeKeys: ReadonlySet<string>): NormalizedLoopCondition {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new QaapJobLoopRequestError(nls.localize('qaap/jobLoops/invalidCondition', 'Invalid loop condition.'));
        }
        const nodeKey = typeof value.nodeKey === 'string' ? value.nodeKey.trim() : '';
        const source = value.source ?? 'result';
        const pointer = value.pointer ?? '';
        const operator = value.operator;
        const hasExpected = Object.prototype.hasOwnProperty.call(value, 'expected');
        if (
            !nodeKey || !nodeKeys.has(nodeKey)
            || (source !== 'result' && source !== 'job')
            || !isValidQaapJsonPointer(pointer)
            || !(QAAP_JOB_LOOP_CONDITION_OPERATORS as readonly unknown[]).includes(operator)
        ) {
            throw new QaapJobLoopRequestError(nls.localize('qaap/jobLoops/invalidCondition', 'Invalid loop condition.'));
        }
        const unary = operator === 'truthy' || operator === 'falsy';
        if (unary === hasExpected) {
            throw new QaapJobLoopRequestError(nls.localize(
                'qaap/jobLoops/invalidConditionExpected',
                'Comparison conditions require "expected"; truthy and falsy conditions must omit it.',
            ));
        }
        if (!unary) {
            this.assertJsonValue(value.expected);
        }
        if (this.isNumericOperator(operator) && (typeof value.expected !== 'number' || !Number.isFinite(value.expected))) {
            throw new QaapJobLoopRequestError(nls.localize(
                'qaap/jobLoops/numericExpected',
                'Numeric loop conditions require a finite numeric expected value.',
            ));
        }
        return { nodeKey, source, pointer, operator, ...(hasExpected ? { expected: value.expected } : {}) };
    }

    protected normalizeBindings(
        node: QaapCreateJobLoopGraphNode,
        nodeKeys: ReadonlySet<string>,
    ): NormalizedLoopInputBinding[] {
        const bindings = node.bindings ?? [];
        if (!Array.isArray(bindings) || bindings.length > MAX_BINDINGS_PER_NODE) {
            throw new QaapJobLoopRequestError(nls.localize(
                'qaap/jobLoops/invalidBindings',
                'A loop node supports at most {0} valid input bindings.',
                String(MAX_BINDINGS_PER_NODE),
            ));
        }
        if (bindings.length > 0 && node.request.kind !== 'function') {
            throw new QaapJobLoopRequestError(nls.localize(
                'qaap/jobLoops/functionBindingsOnly',
                'Loop input bindings are supported only on function jobs.',
            ));
        }
        const templateInput = node.request.kind === 'function' ? node.request.input : undefined;
        const targets = new Set<string>();
        return bindings.map(binding => {
            const from = binding?.from;
            const nodeKey = typeof from?.nodeKey === 'string' ? from.nodeKey.trim() : '';
            const source = from?.source ?? 'result';
            const pointer = from?.pointer ?? '';
            const targetPointer = binding?.targetPointer;
            const targetExists = targetPointer === ''
                || (typeof targetPointer === 'string' && resolveQaapJsonPointer(templateInput, targetPointer).found);
            if (
                !nodeKey || !nodeKeys.has(nodeKey) || (source !== 'result' && source !== 'job')
                || !isValidQaapJsonPointer(pointer) || !isValidQaapJsonPointer(targetPointer)
                || !targetExists || targets.has(targetPointer)
            ) {
                throw new QaapJobLoopRequestError(nls.localize(
                    'qaap/jobLoops/invalidBinding',
                    'Loop bindings must use valid source nodes and existing JSON input targets.',
                ));
            }
            targets.add(targetPointer);
            return { from: { nodeKey, source, pointer }, targetPointer };
        });
    }

    protected async startNextRound(record: PersistedLoopRecord): Promise<void> {
        if (record.loop.state !== 'running') {
            return;
        }
        if (this.stopping) {
            throw new QaapJobLoopRequestError(nls.localize('qaap/jobLoops/stopping', 'The job loop engine is stopping.'));
        }
        if (this.durationExpired(record.loop)) {
            await this.exhaustBudget(record, 'max_duration');
            return;
        }
        const nextIteration = record.loop.iteration + 1;
        const nextJobCount = record.loop.jobsScheduled + record.request.graph.nodes.length;
        if (nextIteration > record.loop.maxIterations) {
            await this.exhaustBudget(record, 'max_iterations');
            return;
        }
        if (nextJobCount > record.loop.maxJobs || nextJobCount > this.maxJobsPerLoop()) {
            await this.exhaustBudget(record, 'job_budget');
            return;
        }
        const result = this.runtime.createGraph({
            nodes: this.materializeGraphNodes(record),
            idempotencyKey: `qaap-loop:${record.loop.id}:${nextIteration}`,
        }, record.loop.ownerLogin);
        const round: QaapJobLoopRound = {
            iteration: nextIteration,
            graphId: result.graph.id,
            startedAt: result.graph.createdAt,
        };
        record.loop = {
            ...record.loop,
            iteration: nextIteration,
            jobsScheduled: nextJobCount,
            rounds: [...record.loop.rounds, round],
            currentGraphId: result.graph.id,
        };
        this.fireLoopEvent(record, 'round_started');
        this.scheduleDeadline(record);
        await this.persist();
    }

    protected materializeGraphNodes(record: PersistedLoopRecord): QaapCreateJobGraphNode[] {
        const previousRound = record.loop.rounds[record.loop.rounds.length - 1];
        const previousGraph = previousRound ? this.runtime.getGraph(previousRound.graphId) : undefined;
        return record.request.graph.nodes.map(node => {
            if (node.request.kind !== 'function') {
                return { key: node.key, request: { ...node.request }, dependsOn: node.dependsOn };
            }
            let input = node.request.input;
            if (previousGraph && node.bindings.length > 0) {
                for (const binding of node.bindings) {
                    const sourceId = previousGraph.graph.jobsByKey[binding.from.nodeKey];
                    const sourceJob = sourceId ? this.runtime.get(sourceId) : undefined;
                    const root = binding.from.source === 'job' ? sourceJob : sourceJob?.result;
                    const source = resolveQaapJsonPointer(root, binding.from.pointer);
                    if (!source.found) {
                        throw new QaapJobLoopBindingError(nls.localize(
                            'qaap/jobLoops/bindingSourceMissing',
                            'A previous-round binding source was not found.',
                        ));
                    }
                    const replaced = replaceQaapJsonPointer(input, binding.targetPointer, source.value);
                    if (!replaced.found) {
                        throw new QaapJobLoopBindingError(nls.localize(
                            'qaap/jobLoops/bindingTargetMissing',
                            'A loop input binding target was not found.',
                        ));
                    }
                    input = replaced.value;
                }
            }
            return {
                key: node.key,
                request: { ...node.request, input },
                dependsOn: node.dependsOn,
            };
        });
    }

    protected async reconcile(id: string): Promise<void> {
        const record = this.records.get(id);
        if (!record || record.loop.state !== 'running' || this.stopping) {
            return;
        }
        if (this.durationExpired(record.loop)) {
            await this.exhaustBudget(record, 'max_duration');
            return;
        }
        if (!record.loop.currentGraphId) {
            await this.startNextRound(record);
            return;
        }
        const detail = this.runtime.getGraph(record.loop.currentGraphId);
        if (!detail) {
            this.finishLoop(record, 'failed', 'graph_missing');
            await this.persist();
            return;
        }
        const jobs = Object.values(detail.jobs);
        if (jobs.length !== record.request.graph.nodes.length) {
            this.finishLoop(record, 'failed', 'graph_missing');
            await this.persist();
            return;
        }
        if (!jobs.every(job => isQaapJobFinished(job.state))) {
            return;
        }
        const finishedAt = Date.now();
        if (!jobs.every(job => didQaapJobSucceed(job.state))) {
            this.replaceCurrentRound(record, { finishedAt, conditionMatched: false });
            this.fireLoopEvent(record, 'round_finished');
            this.finishLoop(record, 'failed', 'graph_failed', finishedAt);
            await this.persist();
            return;
        }
        const conditionMatched = this.evaluateCondition(record);
        this.replaceCurrentRound(record, { finishedAt, conditionMatched });
        record.loop = { ...record.loop, currentGraphId: undefined };
        this.fireLoopEvent(record, 'round_finished');
        if (conditionMatched) {
            this.finishLoop(record, 'succeeded', 'goal_reached', finishedAt);
            await this.persist();
            return;
        }
        if (record.loop.iteration >= record.loop.maxIterations) {
            this.finishLoop(record, 'budget_exhausted', 'max_iterations', finishedAt);
            await this.persist();
            return;
        }
        if (this.durationExpired(record.loop)) {
            this.finishLoop(record, 'budget_exhausted', 'max_duration', finishedAt);
            await this.persist();
            return;
        }
        await this.persist();
        await this.startNextRound(record);
    }

    protected evaluateCondition(record: PersistedLoopRecord): boolean {
        const condition = record.request.until;
        const graph = record.loop.currentGraphId ? this.runtime.getGraph(record.loop.currentGraphId) : undefined;
        const jobId = graph?.graph.jobsByKey[condition.nodeKey];
        const job = jobId ? this.runtime.get(jobId) : undefined;
        if (!job) {
            return false;
        }
        const root = condition.source === 'job' ? job : job.result;
        const resolved = resolveQaapJsonPointer(root, condition.pointer);
        if (!resolved.found) {
            return false;
        }
        const actual = resolved.value;
        switch (condition.operator) {
            case 'equals': return this.stableJson(actual) === this.stableJson(condition.expected);
            case 'not_equals': return this.stableJson(actual) !== this.stableJson(condition.expected);
            case 'greater_than': return typeof actual === 'number' && Number.isFinite(actual) && actual > (condition.expected as number);
            case 'greater_or_equal': return typeof actual === 'number' && Number.isFinite(actual) && actual >= (condition.expected as number);
            case 'less_than': return typeof actual === 'number' && Number.isFinite(actual) && actual < (condition.expected as number);
            case 'less_or_equal': return typeof actual === 'number' && Number.isFinite(actual) && actual <= (condition.expected as number);
            case 'truthy': return Boolean(actual);
            case 'falsy': return !actual;
            default: return false;
        }
    }

    protected replaceCurrentRound(record: PersistedLoopRecord, patch: Partial<QaapJobLoopRound>): void {
        const graphId = record.loop.currentGraphId;
        record.loop = {
            ...record.loop,
            rounds: record.loop.rounds.map(round => round.graphId === graphId ? { ...round, ...patch } : round),
        };
    }

    protected finishLoop(
        record: PersistedLoopRecord,
        state: Exclude<QaapJobLoop['state'], 'running'>,
        terminationReason: QaapJobLoopTerminationReason,
        finishedAt = Date.now(),
    ): void {
        record.loop = { ...record.loop, state, terminationReason, finishedAt, currentGraphId: undefined };
        this.clearDeadline(record.loop.id);
        this.fireLoopEvent(record, 'changed');
    }

    protected async exhaustBudget(
        record: PersistedLoopRecord,
        reason: Extract<QaapJobLoopTerminationReason, 'max_iterations' | 'max_duration' | 'job_budget'>,
    ): Promise<void> {
        this.finishLoop(record, 'budget_exhausted', reason);
        this.cancelCurrentGraph(record);
        await this.persist();
    }

    protected cancelCurrentGraph(record: PersistedLoopRecord): void {
        const currentRound = record.loop.rounds[record.loop.rounds.length - 1];
        const graphId = record.loop.currentGraphId ?? currentRound?.graphId;
        const detail = graphId ? this.runtime.getGraph(graphId) : undefined;
        if (!detail) {
            return;
        }
        for (const job of Object.values(detail.jobs)) {
            if (!isQaapJobFinished(job.state)) {
                this.runtime.cancel(job.id);
            }
        }
    }

    protected reconcileLoopsContaining(jobId: string): void {
        for (const record of this.records.values()) {
            if (record.loop.state !== 'running' || !record.loop.currentGraphId) {
                continue;
            }
            const graph = this.runtime.getGraph(record.loop.currentGraphId);
            if (graph) {
                for (const graphJobId of Object.values(graph.graph.jobsByKey)) {
                    if (graphJobId === jobId) {
                        this.scheduleReconcile(record.loop.id);
                        break;
                    }
                }
            }
        }
    }

    protected scheduleReconcile(id: string): void {
        void this.enqueueLoop(id, () => this.reconcile(id)).catch(error => {
            if (!(error instanceof QaapJobLoopBindingError)) {
                console.warn('[qaap-job-loops] failed to reconcile loop:', error);
            }
            const record = this.records.get(id);
            if (record?.loop.state === 'running') {
                this.finishLoop(record, 'failed', error instanceof QaapJobLoopBindingError
                    ? 'binding_missing'
                    : 'graph_creation_failed');
                void this.persist();
            }
        });
    }

    protected enqueueLoop<T>(id: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.loopChains.get(id) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(operation);
        this.loopChains.set(id, next);
        void next.finally(() => {
            if (this.loopChains.get(id) === next) {
                this.loopChains.delete(id);
            }
        }).catch(() => undefined);
        return next;
    }

    protected scheduleDeadline(record: PersistedLoopRecord): void {
        this.clearDeadline(record.loop.id);
        if (record.loop.state !== 'running' || this.stopping) {
            return;
        }
        const remaining = Math.max(0, record.loop.startedAt + record.loop.maxDurationMs - Date.now());
        const timer = setTimeout(() => {
            this.deadlineTimers.delete(record.loop.id);
            void this.enqueueLoop(record.loop.id, async () => {
                const current = this.records.get(record.loop.id);
                if (current?.loop.state === 'running' && this.durationExpired(current.loop)) {
                    await this.exhaustBudget(current, 'max_duration');
                }
            });
        }, remaining);
        timer.unref?.();
        this.deadlineTimers.set(record.loop.id, timer);
    }

    protected clearDeadline(id: string): void {
        const timer = this.deadlineTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.deadlineTimers.delete(id);
        }
    }

    protected durationExpired(loop: QaapJobLoop): boolean {
        return Date.now() >= loop.startedAt + loop.maxDurationMs;
    }

    protected restorePersistedIndex(stored: unknown): void {
        const index = stored as Partial<PersistedLoopIndex | LegacyPersistedLoopIndex> | undefined;
        if ((index?.version !== 1 && index?.version !== 2) || !Array.isArray(index.loops)) {
            throw new Error('Invalid persisted job loop index.');
        }
        if (index.version === 2) {
            this.eventSequence = Number.isSafeInteger(index.eventSequence) && index.eventSequence! >= 0
                ? index.eventSequence!
                : 0;
            this.events = Array.isArray(index.events)
                ? index.events.filter(event => event?.sequence > 0).slice(-MAX_DURABLE_EVENTS)
                : [];
        }
        for (const record of index.loops) {
            const loop = record?.loop;
            const request = record?.request;
            const fingerprint = record?.fingerprint;
            if (!loop?.id || !request || typeof fingerprint !== 'string') {
                continue;
            }
            this.records.set(loop.id, record);
            if (loop.idempotencyKey) {
                this.idempotencyIndex.set(
                    this.ownerIdempotencyKey(loop.ownerLogin, loop.idempotencyKey),
                    loop.id,
                );
            }
        }
    }

    protected persist(): Promise<void> {
        const snapshot: PersistedLoopIndex = {
            version: 2,
            loops: [...this.records.values()],
            eventSequence: this.eventSequence,
            events: this.events,
        };
        const previous = this.persistChain ?? Promise.resolve();
        this.persistChain = previous
            .catch(() => undefined)
            .then(async () => {
                await fsp.mkdir(this.storeDirectory(), { recursive: true, mode: STORE_MODE });
                await fsp.chmod(this.storeDirectory(), STORE_MODE).catch(() => undefined);
                await writeJsonAtomic(this.indexPath(), snapshot, { mode: INDEX_MODE });
            })
            .catch(error => console.warn('[qaap-job-loops] failed to persist loop index:', error));
        return this.persistChain;
    }

    protected storeDirectory(): string {
        return process.env.QAAP_JOB_LOOP_STATE_DIR?.trim() || path.join(os.homedir(), '.qaap', 'job-loops');
    }

    protected indexPath(): string {
        return path.join(this.storeDirectory(), 'index.json');
    }

    protected maxJobsPerLoop(): number {
        return this.positiveIntegerEnv('QAAP_JOB_LOOP_MAX_JOBS', DEFAULT_MAX_JOBS);
    }

    protected maxActiveLoopsPerOwner(): number {
        return this.positiveIntegerEnv('QAAP_JOB_LOOP_MAX_ACTIVE_PER_USER', DEFAULT_MAX_ACTIVE_PER_USER);
    }

    protected positiveIntegerEnv(name: string, fallback: number): number {
        const value = Number(process.env[name]);
        return Number.isSafeInteger(value) && value > 0 ? value : fallback;
    }

    protected normalizeIdempotencyKey(value: string | undefined): string | undefined {
        const key = value?.trim() || undefined;
        if (key && (key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key))) {
            throw new QaapJobLoopRequestError(nls.localize('qaap/jobLoops/invalidIdempotencyKey', 'Invalid idempotency key.'));
        }
        return key;
    }

    protected ownerIdempotencyKey(ownerLogin: string | undefined, idempotencyKey: string): string {
        return `${ownerLogin ?? ''}\u0000${idempotencyKey}`;
    }

    protected fireLoopEvent(record: PersistedLoopRecord, type: QaapJobLoopEventType): void {
        const loop = record.loop;
        const event: QaapJobLoopEvent = {
            sequence: ++this.eventSequence,
            type,
            at: Date.now(),
            loopId: loop.id,
            ownerLogin: loop.ownerLogin,
            state: loop.state,
            iteration: loop.iteration,
            currentGraphId: loop.currentGraphId,
            terminationReason: loop.terminationReason,
        };
        this.events.push(event);
        if (this.events.length > MAX_DURABLE_EVENTS) {
            this.events.splice(0, this.events.length - MAX_DURABLE_EVENTS);
        }
        this.onDidChangeLoopEmitter.fire(event);
    }

    protected isNumericOperator(operator: QaapJobLoopConditionOperator): boolean {
        return operator === 'greater_than' || operator === 'greater_or_equal'
            || operator === 'less_than' || operator === 'less_or_equal';
    }

    protected assertJsonValue(value: unknown): void {
        let serialized: string | undefined;
        try {
            serialized = JSON.stringify(value);
        } catch {
            serialized = undefined;
        }
        if (serialized === undefined || serialized.length > MAX_CONDITION_CHARS) {
            throw new QaapJobLoopRequestError(nls.localize(
                'qaap/jobLoops/invalidExpectedValue',
                'The loop expected value must be valid bounded JSON.',
            ));
        }
    }

    protected stableJson(value: unknown): string {
        const normalize = (entry: unknown): unknown => {
            if (Array.isArray(entry)) {
                return entry.map(normalize);
            }
            if (entry !== null && typeof entry === 'object') {
                const record = entry as Record<string, unknown>;
                const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
                for (const key of Object.keys(record).sort()) {
                    result[key] = normalize(record[key]);
                }
                return result;
            }
            return entry;
        };
        return JSON.stringify(normalize(value)) ?? 'undefined';
    }
}
