// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Agent Dynamic Workflow IR (ADR-001).
 *
 * Pure data + validation + dry-run stepper. Does not spawn CLIs — the future
 * WorkflowEngine will map {@link QaapWorkflowAgentTurnNode} onto AgentTaskRunner.
 * Job Graphs (`qaap-job`) remain the runtime for non-agent command/function work.
 */

/** Artifact key the `git-diff` node fills and the `adversarial-review` prompt inlines. */
export const QAAP_WORKFLOW_REVIEW_DIFF_ARTIFACT = 'review.diff';
/** Findings of the two parallel explorers, inlined by the `implement-with-findings` prompt. */
export const QAAP_WORKFLOW_STRUCTURE_ARTIFACT = 'explore.structure';
export const QAAP_WORKFLOW_VERIFICATION_ARTIFACT = 'explore.verification';

/** How concurrent writer nodes isolate their working tree. */
export type QaapWorkflowIsolation = 'cwd' | 'worktree' | 'cwd-readonly';

/** Capability hint for routing — resolved to a concrete agent via catalog bindings. */
export type QaapWorkflowCapability =
    | 'explore'
    | 'implement'
    | 'judge'
    | 'measure'
    | 'synthesize'
    | 'creative'
    | 'general';

export type QaapWorkflowCostTier = 'cheap' | 'standard' | 'premium';

/**
 * Stable slot id (e.g. `qaiq`, `codex`, `claude`). Prefer capability + tier on
 * router nodes; pin `agentRef` only when the template must force a backend.
 */
export type QaapWorkflowAgentRef = string;

export type QaapWorkflowEdgeWhen =
    | 'always'
    | 'success'
    | 'fail'
    | 'blocked'
    | 'risk:low'
    | 'risk:high'
    | 'verdict:pass'
    | 'verdict:fail'
    | 'verdict:inconclusive'
    | 'human:continue';

export interface QaapWorkflowAgentTurnNode {
    readonly kind: 'agent-turn';
    readonly id: string;
    readonly capability: QaapWorkflowCapability;
    readonly costTier?: QaapWorkflowCostTier;
    /** Optional hard pin; omit to let the router/catalog choose. */
    readonly agentRef?: QaapWorkflowAgentRef;
    readonly isolation: QaapWorkflowIsolation;
    /** Template id or literal prompt body resolved by the engine. */
    readonly promptRef: string;
    /** When true, the engine expects a parseable @@QAAP:…@@ sentinel. */
    readonly requireSentinel?: boolean;
    /**
     * Run artifact this turn's final message fills, so a later node's prompt can build on it.
     * This is what makes a fan-out worth running: without it parallel explorers produce findings
     * nobody reads.
     */
    readonly artifactKey?: string;
}

export interface QaapWorkflowRouterNode {
    readonly kind: 'router';
    readonly id: string;
    readonly policyId: string;
}

export interface QaapWorkflowJoinNode {
    readonly kind: 'join';
    readonly id: string;
    readonly wait: 'all' | 'any' | 'n';
    readonly n?: number;
}

export interface QaapWorkflowHumanGateNode {
    readonly kind: 'human-gate';
    readonly id: string;
    readonly reasonRef: string;
}

export interface QaapWorkflowDeterministicNode {
    readonly kind: 'deterministic';
    readonly id: string;
    readonly op: 'verify' | 'git-diff' | 'shell' | 'parse-sentinel' | 'risk-classify';
    /**
     * Run artifact this node's output fills, readable by later `promptRef` templates. Without it a
     * node's product is computed and thrown away: the `git-diff` node captured the diff and the
     * judge downstream still reviewed with an empty one.
     */
    readonly artifactKey?: string;
}

export interface QaapWorkflowEmitNode {
    readonly kind: 'emit';
    readonly id: string;
    /** Logical end / export of a binding key. */
    readonly bindingKey: string;
}

export type QaapWorkflowNode =
    | QaapWorkflowAgentTurnNode
    | QaapWorkflowRouterNode
    | QaapWorkflowJoinNode
    | QaapWorkflowHumanGateNode
    | QaapWorkflowDeterministicNode
    | QaapWorkflowEmitNode;

export interface QaapWorkflowEdge {
    readonly from: string;
    readonly to: string;
    readonly when?: QaapWorkflowEdgeWhen;
}

export interface QaapWorkflowDef {
    readonly id: string;
    readonly version: number;
    readonly name: string;
    /**
     * Where the run starts. A list starts every node at once, which is how a graph fans out before
     * anything has run — a single first node could only ever hand off after finishing.
     */
    readonly entry: string | readonly string[];
    readonly nodes: readonly QaapWorkflowNode[];
    readonly edges: readonly QaapWorkflowEdge[];
}

/** The run's initial frontier, normalized from the single-node and multi-node spellings. */
export function qaapWorkflowEntryNodes(def: QaapWorkflowDef): readonly string[] {
    return typeof def.entry === 'string' ? [def.entry] : def.entry;
}

export type QaapWorkflowNodeOutcome =
    | 'success'
    | 'fail'
    | 'blocked'
    | 'risk:low'
    | 'risk:high'
    | 'verdict:pass'
    | 'verdict:fail'
    | 'verdict:inconclusive'
    | 'human:continue';

export interface QaapWorkflowValidationIssue {
    readonly path: string;
    readonly message: string;
}

export interface QaapWorkflowValidationResult {
    readonly ok: boolean;
    readonly issues: readonly QaapWorkflowValidationIssue[];
}

export interface QaapWorkflowStepResult {
    readonly done: boolean;
    readonly current: readonly string[];
    readonly next: readonly string[];
    readonly terminalReason?: 'emit' | 'no-edge' | 'unknown-node';
}

export function validateQaapWorkflowDef(def: QaapWorkflowDef): QaapWorkflowValidationResult {
    const issues: QaapWorkflowValidationIssue[] = [];
    if (!def.id.trim()) {
        issues.push({ path: 'id', message: 'Workflow id is required.' });
    }
    if (!Number.isInteger(def.version) || def.version < 1) {
        issues.push({ path: 'version', message: 'Workflow version must be a positive integer.' });
    }
    if (!def.name.trim()) {
        issues.push({ path: 'name', message: 'Workflow name is required.' });
    }
    if (def.nodes.length === 0) {
        issues.push({ path: 'nodes', message: 'Workflow must declare at least one node.' });
    }

    const byId = new Map<string, QaapWorkflowNode>();
    for (const node of def.nodes) {
        if (!node.id.trim()) {
            issues.push({ path: 'nodes', message: 'Every node needs a non-empty id.' });
            continue;
        }
        if (byId.has(node.id)) {
            issues.push({ path: `nodes.${node.id}`, message: `Duplicate node id "${node.id}".` });
            continue;
        }
        byId.set(node.id, node);
        if (node.kind === 'join' && node.wait === 'n' && (!(node.n !== undefined) || node.n < 1)) {
            issues.push({ path: `nodes.${node.id}`, message: 'Join wait "n" requires n >= 1.' });
        }
        if (node.kind === 'router') {
            // `policyId` has no engine, so a dispatched router could never report an outcome and
            // the run would hang on it. Reject the definition instead of accepting a graph we
            // cannot execute; capability + costTier already cover backend selection today.
            issues.push({
                path: `nodes.${node.id}`,
                message: 'Router nodes are not executable yet: route with capability + costTier on the agent-turn instead.',
            });
        }
        if (node.kind === 'agent-turn' && node.isolation === 'worktree' && node.capability === 'judge') {
            // Judges are read-only by product contract; worktree isolation is wasteful/wrong.
            issues.push({
                path: `nodes.${node.id}`,
                message: 'Judge agent-turn nodes must use cwd-readonly isolation.',
            });
        }
    }

    const entries = qaapWorkflowEntryNodes(def);
    if (entries.length === 0) {
        issues.push({ path: 'entry', message: 'Workflow must declare at least one entry node.' });
    }
    for (const entry of entries) {
        if (!byId.has(entry)) {
            issues.push({ path: 'entry', message: `Entry node "${entry}" is not declared.` });
        }
    }

    for (let i = 0; i < def.edges.length; i++) {
        const edge = def.edges[i];
        const path = `edges[${i}]`;
        if (!byId.has(edge.from)) {
            issues.push({ path, message: `Edge from unknown node "${edge.from}".` });
        }
        if (!byId.has(edge.to)) {
            issues.push({ path, message: `Edge to unknown node "${edge.to}".` });
        }
    }

    issues.push(...findConcurrentCwdWriterIssues(def, byId));

    return { ok: issues.length === 0, issues };
}

/**
 * Shared-cwd writers are only unsafe when two of them can be active at the same time, i.e. when
 * a fan-out puts them on sibling branches. Sequential writers (implement → fix) are legitimate,
 * as are writers on the common suffix the branches reconverge into.
 */
function findConcurrentCwdWriterIssues(
    def: QaapWorkflowDef,
    byId: ReadonlyMap<string, QaapWorkflowNode>,
): QaapWorkflowValidationIssue[] {
    const issues: QaapWorkflowValidationIssue[] = [];
    const reported = new Set<string>();
    // The entry frontier is a fan-out too: multi-entry graphs start their branches simultaneously.
    const entries = qaapWorkflowEntryNodes(def);
    const groups: { readonly source: string; readonly branches: string[][] }[] = [
        ...(entries.length >= 2 ? [{ source: 'entry', branches: [[...entries]] as string[][] }] : []),
        ...def.nodes.map(node => ({ source: node.id, branches: collectFanOutBranches(def, node.id) })),
    ];
    for (const group of groups) {
        for (const branches of group.branches) {
            const reachable = branches.map(branch => reachableFrom(def, branch));
            const shared = intersectAll(reachable);
            const owners = reachable.map(
                (set, index) => ({ branch: branches[index], writers: cwdWriterIds(set, shared, byId) }),
            ).filter(entry => entry.writers.length > 0);
            if (owners.length < 2) {
                continue;
            }
            const conflicting = owners.flatMap(entry => entry.writers).sort();
            const key = `${group.source}:${conflicting.join(',')}`;
            if (reported.has(key)) {
                continue;
            }
            reported.add(key);
            issues.push({
                path: group.source === 'entry' ? 'entry' : `nodes.${group.source}`,
                message:
                    `Fan-out from "${group.source}" runs agent-turn nodes ${conflicting.map(id => `"${id}"`).join(', ')} ` +
                    'concurrently on isolation "cwd"; concurrent writers need "worktree".',
            });
        }
    }
    return issues;
}

/** Groups of successor nodes that a single outcome activates simultaneously. */
function collectFanOutBranches(def: QaapWorkflowDef, from: string): string[][] {
    const outgoing = def.edges.filter(edge => edge.from === from);
    if (outgoing.length < 2) {
        return [];
    }
    const outcomes = new Set<QaapWorkflowEdgeWhen>(outgoing.map(edge => edge.when ?? 'always'));
    const groups: string[][] = [];
    for (const outcome of outcomes) {
        const targets = outgoing
            .filter(edge => (edge.when ?? 'always') === 'always' || edge.when === outcome)
            .map(edge => edge.to);
        const unique = [...new Set(targets)];
        if (unique.length >= 2) {
            groups.push(unique);
        }
    }
    return groups;
}

function reachableFrom(def: QaapWorkflowDef, start: string): Set<string> {
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const edge of def.edges) {
            if (edge.from === current && !seen.has(edge.to)) {
                seen.add(edge.to);
                queue.push(edge.to);
            }
        }
    }
    return seen;
}

function intersectAll(sets: readonly Set<string>[]): Set<string> {
    if (sets.length === 0) {
        return new Set();
    }
    const [first, ...rest] = sets;
    return new Set([...first].filter(id => rest.every(set => set.has(id))));
}

function cwdWriterIds(
    branch: ReadonlySet<string>,
    shared: ReadonlySet<string>,
    byId: ReadonlyMap<string, QaapWorkflowNode>,
): string[] {
    return [...branch]
        .filter(id => !shared.has(id))
        .filter(id => {
            const node = byId.get(id);
            return node?.kind === 'agent-turn' && node.isolation === 'cwd';
        })
        .sort();
}

/**
 * Dry-run one step: given the active node ids and the outcome of the node that just finished,
 * return the next frontier. Does not execute side effects.
 */
export function stepQaapWorkflow(
    def: QaapWorkflowDef,
    current: readonly string[],
    finishedNodeId: string,
    outcome: QaapWorkflowNodeOutcome,
): QaapWorkflowStepResult {
    const byId = new Map(def.nodes.map(n => [n.id, n]));
    const finished = byId.get(finishedNodeId);
    if (!finished) {
        return { done: true, current, next: [], terminalReason: 'unknown-node' };
    }
    if (finished.kind === 'emit') {
        return { done: true, current: [finishedNodeId], next: [], terminalReason: 'emit' };
    }

    const outgoing = def.edges.filter(edge => edge.from === finishedNodeId);
    const matched = outgoing.filter(edge => edgeMatches(edge.when ?? 'always', outcome));
    if (matched.length === 0) {
        return { done: true, current: [finishedNodeId], next: [], terminalReason: 'no-edge' };
    }

    const next = matched.map(edge => edge.to);
    const onlyEmit = next.length === 1 && byId.get(next[0])?.kind === 'emit';
    if (onlyEmit) {
        return { done: true, current: next, next, terminalReason: 'emit' };
    }
    return { done: false, current: [finishedNodeId], next };
}

function edgeMatches(when: QaapWorkflowEdgeWhen, outcome: QaapWorkflowNodeOutcome): boolean {
    if (when === 'always') {
        return true;
    }
    return when === outcome;
}

/**
 * Which changes enter the adversarial review, mirroring `QAAP_AGENT_REVIEW` via
 * {@code resolveAgentReviewMode}: `high-risk` gates on the risk classifier (the default), `all`
 * reviews every edited change, and `off` skips review entirely.
 */
export type QaapWorkflowReviewMode = 'high-risk' | 'all' | 'off';

/** Definition ids are the contract a run is replayed against, so each shape owns one. */
function definitionId(withExploration: boolean): string {
    return withExploration ? 'qaap.explore-then-implement' : 'qaap.implement-then-review';
}

/** Shown on every node's task title, so it must describe the shape that actually ran. */
function definitionName(withExploration: boolean, reviewMode: QaapWorkflowReviewMode): string {
    if (withExploration) {
        return 'Explore in parallel, then implement and review';
    }
    return reviewMode === 'all' ? 'Implement then review every change' : 'Implement then adversarial review';
}

/**
 * Product template matching today's Implement → (optional risk gate) → Adversarial Review flow
 * in {@code finishSuccessfulTaskAfterVerification}. Engine wiring comes later; this IR is the
 * contract the runner will execute.
 */
export function buildImplementThenReviewWorkflow(options?: {
    readonly implementAgentRef?: QaapWorkflowAgentRef;
    readonly judgeAgentRef?: QaapWorkflowAgentRef;
    readonly exploreAgentRef?: QaapWorkflowAgentRef;
    readonly reviewMode?: QaapWorkflowReviewMode;
    /**
     * Start with two read-only explorers on different lenses (where the change belongs, how the
     * repo is verified), join them, and hand their findings to the implement turn. This is the one
     * shape a linear agent loop cannot express, and the reason joins exist.
     */
    readonly withParallelExploration?: boolean;
    /**
     * Insert the runner's post-implement verification with its fix-loop
     * (`verify` fail → `implement-fix` → `verify`). Opt-in for now: the default graph stays as the
     * review conformance proved it, and the loop is bounded by the run's `maxVisitsPerNode` budget.
     */
    readonly withVerify?: boolean;
}): QaapWorkflowDef {
    const reviewMode = options?.reviewMode ?? 'high-risk';
    const withVerify = options?.withVerify ?? false;
    const withExploration = options?.withParallelExploration ?? false;
    const nodes: QaapWorkflowNode[] = [
        {
            kind: 'agent-turn',
            id: 'implement',
            capability: 'implement',
            costTier: 'standard',
            agentRef: options?.implementAgentRef,
            isolation: 'cwd',
            promptRef: withExploration ? 'implement-with-findings' : 'user-task',
        },
        { kind: 'emit', id: 'done-skip', bindingKey: 'review.skipped' },
    ];
    const edges: QaapWorkflowEdge[] = [
        { from: 'implement', to: 'done-skip', when: 'fail' },
        { from: 'implement', to: 'done-skip', when: 'blocked' },
    ];

    // Parallel prefix. Both explorers are read-only, so they share the cwd safely; their findings
    // reach `implement` as run artifacts, and the join is what makes it wait for both.
    const entry: string | readonly string[] = withExploration ? ['explore-structure', 'explore-verification'] : 'implement';
    if (withExploration) {
        nodes.push(
            {
                kind: 'agent-turn',
                id: 'explore-structure',
                capability: 'explore',
                costTier: 'cheap',
                agentRef: options?.exploreAgentRef,
                isolation: 'cwd-readonly',
                promptRef: 'explore-structure',
                artifactKey: QAAP_WORKFLOW_STRUCTURE_ARTIFACT,
            },
            {
                kind: 'agent-turn',
                id: 'explore-verification',
                capability: 'explore',
                costTier: 'cheap',
                agentRef: options?.exploreAgentRef,
                isolation: 'cwd-readonly',
                promptRef: 'explore-verification',
                artifactKey: QAAP_WORKFLOW_VERIFICATION_ARTIFACT,
            },
            { kind: 'join', id: 'explored', wait: 'all' },
        );
        edges.push(
            // 'always', not 'success': one explorer that dies must not strand the other's findings —
            // the implement turn simply starts with less context.
            { from: 'explore-structure', to: 'explored', when: 'always' },
            { from: 'explore-verification', to: 'explored', when: 'always' },
            { from: 'explored', to: 'implement', when: 'always' },
        );
    }

    // Node a successful implement hands off to: verification when enabled, else straight on.
    const afterImplement = withVerify ? 'verify' : undefined;
    if (withVerify) {
        nodes.push(
            { kind: 'deterministic', id: 'verify', op: 'verify' },
            {
                kind: 'agent-turn',
                id: 'implement-fix',
                capability: 'implement',
                costTier: 'standard',
                agentRef: options?.implementAgentRef,
                isolation: 'cwd',
                promptRef: 'fix-verification',
            },
            { kind: 'emit', id: 'done-unverified', bindingKey: 'verify.failed' },
        );
        edges.push(
            { from: 'implement', to: 'verify', when: 'success' },
            // Fix-loop: a failed verification re-enters an implement turn, which verifies again.
            // Termination comes from the run budget (maxVisitsPerNode), not from the graph.
            { from: 'verify', to: 'implement-fix', when: 'fail' },
            { from: 'implement-fix', to: 'verify', when: 'success' },
            // A fix turn that cannot run leaves the change unverified rather than looping forever.
            { from: 'implement-fix', to: 'done-unverified', when: 'fail' },
            { from: 'implement-fix', to: 'done-unverified', when: 'blocked' },
        );
    }

    if (reviewMode === 'off') {
        // No review at all: a successful implement (or verification) is the terminal skip, like the
        // runner returning undefined when QAAP_AGENT_REVIEW is off.
        edges.push({ from: afterImplement ?? 'implement', to: 'done-skip', when: 'success' });
        return {
            id: definitionId(withExploration),
            version: 1,
            name: withExploration ? 'Explore in parallel, then implement (review off)' : 'Implement (review off)',
            entry,
            nodes,
            edges,
        };
    }

    nodes.push(
        { kind: 'deterministic', id: 'risk-classify', op: 'risk-classify' },
        // The captured diff becomes the artifact the judge's prompt inlines.
        { kind: 'deterministic', id: 'git-diff', op: 'git-diff', artifactKey: QAAP_WORKFLOW_REVIEW_DIFF_ARTIFACT },
        {
            kind: 'agent-turn',
            id: 'judge',
            capability: 'judge',
            costTier: 'standard',
            agentRef: options?.judgeAgentRef,
            isolation: 'cwd-readonly',
            promptRef: 'adversarial-review',
            requireSentinel: true,
        },
        { kind: 'emit', id: 'done-pass', bindingKey: 'review.passed' },
        { kind: 'emit', id: 'done-fail', bindingKey: 'review.failed' },
        { kind: 'emit', id: 'done-inconclusive', bindingKey: 'review.inconclusive' },
    );
    edges.push({ from: afterImplement ?? 'implement', to: 'risk-classify', when: 'success' });
    if (reviewMode === 'all') {
        // No gate: every edited change reaches the judge, low or high risk.
        edges.push(
            { from: 'risk-classify', to: 'git-diff', when: 'risk:low' },
            { from: 'risk-classify', to: 'git-diff', when: 'risk:high' },
        );
    } else {
        // high-risk gates on the classifier: only high-risk diffs enter the judge.
        edges.push(
            { from: 'risk-classify', to: 'done-skip', when: 'risk:low' },
            { from: 'risk-classify', to: 'git-diff', when: 'risk:high' },
        );
    }
    edges.push(
        { from: 'git-diff', to: 'judge', when: 'success' },
        { from: 'git-diff', to: 'done-inconclusive', when: 'fail' },
        { from: 'judge', to: 'done-pass', when: 'verdict:pass' },
        { from: 'judge', to: 'done-fail', when: 'verdict:fail' },
        { from: 'judge', to: 'done-inconclusive', when: 'verdict:inconclusive' },
        { from: 'judge', to: 'done-inconclusive', when: 'fail' },
    );
    return {
        id: definitionId(withExploration),
        version: 1,
        name: definitionName(withExploration, reviewMode),
        entry,
        nodes,
        edges,
    };
}

/** Walk a linear dry-run path for tests and diagnostics. Follows the FIRST entry of a fan-out. */
export function dryRunQaapWorkflowPath(
    def: QaapWorkflowDef,
    outcomes: Readonly<Record<string, QaapWorkflowNodeOutcome>>,
): readonly string[] {
    let current = qaapWorkflowEntryNodes(def)[0];
    const path: string[] = [current];
    const guard = def.nodes.length + def.edges.length + 8;
    for (let i = 0; i < guard; i++) {
        const outcome = outcomes[current];
        if (!outcome) {
            break;
        }
        const step = stepQaapWorkflow(def, [current], current, outcome);
        if (step.next.length === 0) {
            break;
        }
        current = step.next[0];
        path.push(current);
        if (step.done) {
            break;
        }
    }
    return path;
}
