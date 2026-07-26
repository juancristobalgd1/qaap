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
/** The plan a person approves before any file is touched. */
export const QAAP_WORKFLOW_PLAN_ARTIFACT = 'plan.proposal';

/**
 * One lens of a multi-lens review: a distinct QUESTION about the same diff, the node that asks it,
 * and the artifact its findings land in for the synthesis turn to weigh.
 *
 * Three lenses instead of one judge because a single verdict says nothing about its own
 * reliability: three questions that disagree are information ("two lenses passed it, the safety one
 * did not"), where one silent pass is only a coin whose bias nobody measured.
 */
export interface QaapWorkflowReviewLens {
    readonly nodeId: string;
    readonly promptRef: string;
    readonly artifactKey: string;
}

/**
 * The lenses of the multi-lens review, deliberately non-overlapping: does the change WORK, is it
 * SAFE, and is it what was actually ASKED. Two lenses asking the same question would double the
 * cost for one answer.
 */
export const QAAP_WORKFLOW_REVIEW_LENSES: readonly QaapWorkflowReviewLens[] = [
    { nodeId: 'judge-correctness', promptRef: 'review-lens-correctness', artifactKey: 'review.lens.correctness' },
    { nodeId: 'judge-safety', promptRef: 'review-lens-safety', artifactKey: 'review.lens.safety' },
    { nodeId: 'judge-intent', promptRef: 'review-lens-intent', artifactKey: 'review.lens.intent' },
];

/** The plan reviewer's objections, handed back to the plan turn when it has to try again. */
export const QAAP_WORKFLOW_PLAN_REVIEW_ARTIFACT = 'plan.review';

/**
 * What the failing verification actually printed, captured by the `verify` node and inlined by the
 * fix prompts. Without it the fix turn is told "verification failed", is asked to "read the
 * failure", and has no failure to read: measured live, it re-explored the repository from scratch
 * before touching anything.
 */
export const QAAP_WORKFLOW_VERIFY_FAILURE_ARTIFACT = 'verify.failure';

/**
 * The reviewer of record's verdict, kept so the turn that has to answer it can read the objections
 * instead of guessing what was wrong with a change the graph already rejected.
 */
export const QAAP_WORKFLOW_REVIEW_VERDICT_ARTIFACT = 'review.verdict';

/**
 * What a node may do to the run's working tree.
 *
 * There is deliberately no per-node worktree here. The value existed, no template ever declared it,
 * and nothing in the runtime read it — a `worktree` node was dispatched on `record.cwd` exactly like
 * a `cwd` one. That made it worse than inert: {@link validateQaapWorkflow} told you concurrent
 * writers "need worktree", while the check that caught them only counts `cwd` writers, so following
 * the advice silenced the error and left both turns writing the same directory.
 *
 * Real per-node isolation is not a value in this union: the whole review lane measures `record.cwd`,
 * so an isolated implement turn would produce an empty diff, low risk, and a judge reviewing
 * nothing. It needs a per-node cwd in the run store, deterministic ops honouring it, a merge-back
 * op, and reaping on every termination path — none of which exists. Concurrent writers are rejected
 * instead of being pointed at a remedy that is not there.
 */
export type QaapWorkflowIsolation = 'cwd' | 'cwd-readonly';

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
    /**
     * Run artifact the person is being asked to decide ON, e.g. the plan a turn just wrote. A gate
     * without it asks someone to approve something they cannot see.
     */
    readonly detailArtifactKey?: string;
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
        if (node.kind === 'agent-turn' && node.capability === 'judge' && node.isolation !== 'cwd-readonly') {
            // A judge that can edit the change it reviews does not produce a weaker verdict, it
            // produces none. The dispatcher only restricts a turn it was told is read-only, so this
            // is what makes the restriction reachable for judges at all.
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
                    'concurrently on isolation "cwd": they would write the same working tree at the same time. ' +
                    'Sequence them, or make all but one "cwd-readonly".',
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

/** Which optional prefixes and review shape a build asked for; the id and name derive from it. */
interface QaapWorkflowShape {
    readonly withExploration: boolean;
    readonly withGoal: boolean;
    readonly withPlan: boolean;
    readonly withPlanGate: boolean;
    readonly withMultiLensReview: boolean;
}

/** Definition ids are the contract a run is replayed against, so each shape owns one. */
function definitionId(shape: QaapWorkflowShape): string {
    if (shape.withPlanGate) {
        return 'qaap.plan-gate-then-implement';
    }
    if (shape.withPlan) {
        return 'qaap.plan-then-implement';
    }
    if (shape.withGoal) {
        return 'qaap.goal';
    }
    if (shape.withMultiLensReview) {
        return 'qaap.multi-lens-review';
    }
    return shape.withExploration ? 'qaap.explore-then-implement' : 'qaap.implement-then-review';
}

/** Shown on every node's task title, so it must describe the shape that actually ran. */
function definitionName(shape: QaapWorkflowShape, reviewMode: QaapWorkflowReviewMode): string {
    if (shape.withPlanGate) {
        return 'Plan, review the plan, then implement';
    }
    if (shape.withPlan) {
        return 'Plan first, implement after approval';
    }
    if (shape.withGoal) {
        return 'Work until the goal check passes';
    }
    if (shape.withMultiLensReview) {
        return 'Implement, then review through three lenses';
    }
    if (shape.withExploration) {
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
     * Run against a declared GOAL rather than an instruction: the turn is told what "done" means
     * mechanically, and the run does not finish until the success check passes. Implies the
     * verification fix-loop, since without it nothing would re-enter the graph when the check is
     * red — the loop is what makes a goal a goal instead of a wish.
     */
    readonly withGoal?: boolean;
    /**
     * Propose a plan read-only and WAIT for a person before touching anything. The pause is a real
     * human gate, so the run survives a restart while it waits, and the approved plan travels into
     * the implement turn instead of being re-derived.
     */
    readonly withPlan?: boolean;
    /**
     * Insert the runner's post-implement verification with its fix-loop
     * (`verify` fail → `implement-fix` → `verify`). Opt-in for now: the default graph stays as the
     * review conformance proved it, and the loop is bounded by the run's `maxVisitsPerNode` budget.
     */
    readonly withVerify?: boolean;
    /**
     * Review the diff through {@link QAAP_WORKFLOW_REVIEW_LENSES} at once and let a synthesis turn
     * issue the single verdict. Opt-in because it multiplies the review cost by the number of
     * lenses, and that is the caller's call, not the template's.
     */
    readonly withMultiLensReview?: boolean;
    /**
     * Gate the run on a REVIEWED plan: a read-only plan turn writes its proposal, a judge accepts or
     * rejects it, and only an accepted plan reaches the implement turn. A rejected plan re-enters
     * the PLAN turn — never the implement turn — carrying the reviewer's objections, so nothing is
     * written on a plan that did not survive scrutiny.
     */
    readonly withPlanGate?: boolean;
    /**
     * Close the review loop: a `verdict:fail` re-enters a fix turn carrying the reviewer's
     * objections and the diff it wrote, and the fixed change is captured and judged again — instead
     * of the graph detecting the problem and giving up on it.
     *
     * Opt-in, like every other topology change here, and for a sharper reason: the default graph's
     * `verdict:fail → done-fail` is the contract `qaap-workflow-review-conformance.spec.ts` pins
     * against the runner's own review decision. Turning the loop on by default would make a rejected
     * change end somewhere the runner never ends, and would spend a fix turn plus a whole second
     * review on every run that is rejected today.
     */
    readonly withReviewFixLoop?: boolean;
}): QaapWorkflowDef {
    const reviewMode = options?.reviewMode ?? 'high-risk';
    const withVerify = (options?.withVerify ?? false) || (options?.withGoal ?? false);
    const withExploration = options?.withParallelExploration ?? false;
    const withGoal = options?.withGoal ?? false;
    const withPlanGate = options?.withPlanGate ?? false;
    // The human gate and the judge gate both own the `plan` node id and the run's entry, so a build
    // takes one of them. The reviewed gate wins: it is the more specific request.
    const withPlan = (options?.withPlan ?? false) && !withPlanGate;
    const withMultiLensReview = options?.withMultiLensReview ?? false;
    const shape: QaapWorkflowShape = { withExploration, withGoal, withPlan, withPlanGate, withMultiLensReview };
    const nodes: QaapWorkflowNode[] = [
        {
            kind: 'agent-turn',
            id: 'implement',
            capability: 'implement',
            costTier: 'standard',
            agentRef: options?.implementAgentRef,
            isolation: 'cwd',
            promptRef: withPlanGate ? 'implement-reviewed-plan'
                : withPlan ? 'implement-approved-plan'
                    : withGoal ? 'goal-task'
                        : withExploration ? 'implement-with-findings' : 'user-task',
        },
        { kind: 'emit', id: 'done-skip', bindingKey: 'review.skipped' },
    ];
    const edges: QaapWorkflowEdge[] = [
        { from: 'implement', to: 'done-skip', when: 'fail' },
        { from: 'implement', to: 'done-skip', when: 'blocked' },
    ];

    // Plan prefix. The plan turn is read-only, so nothing is touched before a person has seen what
    // is about to happen; the gate holds the run in `awaiting-human` until they continue it.
    if (withPlan) {
        nodes.push(
            {
                kind: 'agent-turn',
                id: 'plan',
                capability: 'explore',
                costTier: 'standard',
                agentRef: options?.exploreAgentRef,
                isolation: 'cwd-readonly',
                promptRef: 'plan-task',
                artifactKey: QAAP_WORKFLOW_PLAN_ARTIFACT,
            },
            { kind: 'human-gate', id: 'approve-plan', reasonRef: 'plan-approval', detailArtifactKey: QAAP_WORKFLOW_PLAN_ARTIFACT },
            { kind: 'emit', id: 'done-unplanned', bindingKey: 'plan.failed' },
        );
        edges.push(
            { from: 'plan', to: 'approve-plan', when: 'success' },
            // A plan turn that could not run must not silently become an unplanned implementation.
            { from: 'plan', to: 'done-unplanned', when: 'fail' },
            { from: 'plan', to: 'done-unplanned', when: 'blocked' },
            { from: 'approve-plan', to: 'implement', when: 'human:continue' },
        );
    }

    // Reviewed-plan prefix. The whole point is that the compuerta sits BEFORE the first edit: the
    // plan turn is read-only, the judge reads the proposal, and a rejected plan costs one read-only
    // turn instead of a diff nobody wanted. Everything downstream (implement → verify → review) is
    // the unchanged tail, so the gate is a prefix and not a second graph.
    if (withPlanGate) {
        nodes.push(
            {
                kind: 'agent-turn',
                id: 'plan',
                // 'explore', not a new capability: the act is the same one the explore lane already
                // names — read the repository and report, writing nothing. It also routes to the
                // strong backends first (see DEFAULT_QAAP_WORKFLOW_ROUTING_TABLE), which is what a
                // plan the rest of the run is judged against deserves.
                capability: 'explore',
                costTier: 'standard',
                agentRef: options?.exploreAgentRef,
                isolation: 'cwd-readonly',
                promptRef: 'plan-under-review',
                artifactKey: QAAP_WORKFLOW_PLAN_ARTIFACT,
            },
            {
                kind: 'agent-turn',
                id: 'judge-plan',
                capability: 'judge',
                costTier: 'standard',
                agentRef: options?.judgeAgentRef,
                isolation: 'cwd-readonly',
                promptRef: 'plan-review',
                requireSentinel: true,
                // The objections travel back into the plan turn; without this the rejected turn
                // would be asked to try again with no idea what was wrong with the first attempt.
                artifactKey: QAAP_WORKFLOW_PLAN_REVIEW_ARTIFACT,
            },
            { kind: 'emit', id: 'done-unplanned', bindingKey: 'plan.failed' },
            { kind: 'emit', id: 'done-plan-inconclusive', bindingKey: 'plan.inconclusive' },
        );
        edges.push(
            { from: 'plan', to: 'judge-plan', when: 'success' },
            // A plan turn that could not run must not silently become an unplanned implementation.
            { from: 'plan', to: 'done-unplanned', when: 'fail' },
            { from: 'plan', to: 'done-unplanned', when: 'blocked' },
            { from: 'judge-plan', to: 'implement', when: 'verdict:pass' },
            // Rejection re-enters the PLAN turn, not the implement turn: the run replans instead of
            // building on a plan that was just refused. Bounded by the run's `maxVisitsPerNode`.
            { from: 'judge-plan', to: 'plan', when: 'verdict:fail' },
            // Unlike the post-implement review — where the work is already paid for, so an
            // undecidable verdict keeps it and flags it — here nothing has been written yet.
            // Stopping costs one read-only turn; implementing on a plan the gate could not judge
            // would make the gate optional in exactly the case it exists for.
            { from: 'judge-plan', to: 'done-plan-inconclusive', when: 'verdict:inconclusive' },
            { from: 'judge-plan', to: 'done-unplanned', when: 'fail' },
            { from: 'judge-plan', to: 'done-unplanned', when: 'blocked' },
        );
    }

    // Parallel prefix. Both explorers are read-only, so they share the cwd safely; their findings
    // reach `implement` as run artifacts, and the join is what makes it wait for both.
    const entry: string | readonly string[] = withPlan || withPlanGate ? 'plan'
        : withExploration ? ['explore-structure', 'explore-verification'] : 'implement';
    if (withExploration) {
        nodes.push(
            {
                kind: 'agent-turn',
                id: 'explore-structure',
                capability: 'explore',
                // Not 'cheap': these findings are what the implement turn builds on, so a wrong map
                // costs far more than the turn saved. Cheapness is the caller's call, not ours.
                costTier: 'standard',
                agentRef: options?.exploreAgentRef,
                isolation: 'cwd-readonly',
                promptRef: 'explore-structure',
                artifactKey: QAAP_WORKFLOW_STRUCTURE_ARTIFACT,
            },
            {
                kind: 'agent-turn',
                id: 'explore-verification',
                capability: 'explore',
                // Not 'cheap': these findings are what the implement turn builds on, so a wrong map
                // costs far more than the turn saved. Cheapness is the caller's call, not ours.
                costTier: 'standard',
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
            // The failing output is the artifact: a fix turn that cannot see what broke re-derives
            // it, and the prompt that tells it to "read the failure" has nothing to point at.
            { kind: 'deterministic', id: 'verify', op: 'verify', artifactKey: QAAP_WORKFLOW_VERIFY_FAILURE_ARTIFACT },
            {
                kind: 'agent-turn',
                id: 'implement-fix',
                capability: 'implement',
                costTier: 'standard',
                agentRef: options?.implementAgentRef,
                isolation: 'cwd',
                promptRef: withGoal ? 'fix-goal' : 'fix-verification',
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
            id: definitionId(shape),
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
        { kind: 'emit', id: 'done-pass', bindingKey: 'review.passed' },
        { kind: 'emit', id: 'done-fail', bindingKey: 'review.failed' },
        { kind: 'emit', id: 'done-inconclusive', bindingKey: 'review.inconclusive' },
    );

    // Which node actually issues the verdict: the lone judge, or the turn that synthesizes the
    // lenses. Everything after it is wired against this id, so the two shapes share one tail.
    const verdictNodeId = withMultiLensReview ? 'review-synthesis' : 'judge';
    if (withMultiLensReview) {
        for (const lens of QAAP_WORKFLOW_REVIEW_LENSES) {
            nodes.push({
                kind: 'agent-turn',
                id: lens.nodeId,
                capability: 'judge',
                costTier: 'standard',
                agentRef: options?.judgeAgentRef,
                isolation: 'cwd-readonly',
                promptRef: lens.promptRef,
                // No sentinel: a lens reports FINDINGS. If each lens emitted its own verdict the
                // graph would have three verdicts and no decision, and the first one to say "fail"
                // would silently become the run's answer.
                artifactKey: lens.artifactKey,
            });
            // 'always', not 'success': a lens that dies must not strand the other two at the join —
            // that is exactly the fan-in that hung runs forever before. The synthesis turn is told
            // which lenses are missing and weighs what it has.
            edges.push({ from: 'git-diff', to: lens.nodeId, when: 'success' });
            edges.push({ from: lens.nodeId, to: 'reviewed', when: 'always' });
        }
        nodes.push(
            { kind: 'join', id: 'reviewed', wait: 'all' },
            {
                kind: 'agent-turn',
                id: verdictNodeId,
                // 'judge', not 'synthesize': this turn DECIDES. It must be routed away from the
                // backend that wrote the change (see the judge-independence rule) and onto the
                // review model slot, which a 'synthesize' capability would not do.
                capability: 'judge',
                costTier: 'standard',
                agentRef: options?.judgeAgentRef,
                isolation: 'cwd-readonly',
                promptRef: 'synthesize-review',
                requireSentinel: true,
                // The verdict is kept whether or not the fix loop is on: it costs one capped
                // artifact, and it is the only record of WHY a run ended rejected.
                artifactKey: QAAP_WORKFLOW_REVIEW_VERDICT_ARTIFACT,
            },
        );
        edges.push({ from: 'reviewed', to: verdictNodeId, when: 'always' });
    } else {
        nodes.push({
            kind: 'agent-turn',
            id: verdictNodeId,
            capability: 'judge',
            costTier: 'standard',
            agentRef: options?.judgeAgentRef,
            isolation: 'cwd-readonly',
            promptRef: 'adversarial-review',
            requireSentinel: true,
            artifactKey: QAAP_WORKFLOW_REVIEW_VERDICT_ARTIFACT,
        });
        edges.push({ from: 'git-diff', to: verdictNodeId, when: 'success' });
    }
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
        { from: 'git-diff', to: 'done-inconclusive', when: 'fail' },
        { from: verdictNodeId, to: 'done-pass', when: 'verdict:pass' },
        { from: verdictNodeId, to: 'done-inconclusive', when: 'verdict:inconclusive' },
        { from: verdictNodeId, to: 'done-inconclusive', when: 'fail' },
    );
    if (options?.withReviewFixLoop) {
        // The review fix-loop, mirroring the plan gate's `judge-plan --verdict:fail--> plan`: the
        // rejection re-enters a turn that is HANDED the objections, and the result is judged again.
        nodes.push({
            kind: 'agent-turn',
            id: 'implement-review-fix',
            capability: 'implement',
            costTier: 'standard',
            agentRef: options?.implementAgentRef,
            isolation: 'cwd',
            // Its own node, not the verification fix turn: `fix-verification` would tell this turn
            // the build is red when a reviewer rejected it, and with `withVerify` off that node does
            // not exist at all. A separate id also keeps the two loops on separate visit budgets.
            promptRef: 'fix-review',
        });
        edges.push(
            { from: verdictNodeId, to: 'implement-review-fix', when: 'verdict:fail' },
            // Straight back to the capture, deliberately skipping the risk gate: the change is
            // already under review, and re-classifying it could route a rejected-then-edited change
            // to `done-skip` — a rejection laundered into "review skipped".
            { from: 'implement-review-fix', to: 'git-diff', when: 'success' },
            // A fix turn that cannot run leaves the change rejected, which is what it was.
            { from: 'implement-review-fix', to: 'done-fail', when: 'fail' },
            { from: 'implement-review-fix', to: 'done-fail', when: 'blocked' },
        );
    } else {
        edges.push({ from: verdictNodeId, to: 'done-fail', when: 'verdict:fail' });
    }
    if (withMultiLensReview) {
        // A synthesis turn that is cancelled would otherwise leave the run with no edge to follow.
        // The lone judge keeps its historical edge set, which the review conformance pinned.
        edges.push({ from: verdictNodeId, to: 'done-inconclusive', when: 'blocked' });
    }
    return {
        id: definitionId(shape),
        version: 1,
        name: definitionName(shape, reviewMode),
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
