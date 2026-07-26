// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Server-side allowlist of runnable workflow graphs (ADR-001).
 *
 * The HTTP API starts a run by template id, never by an inline definition, so the set of graphs a
 * client can execute is fixed here. Each template declares which inputs it requires so a start
 * request can be validated before anything is spawned.
 */

import { resolveAgentReviewMode } from './qaap-agent-review';
import { QaapWorkflowTemplateSummary } from './qaap-workflow-api';
import { buildImplementThenReviewWorkflow, QaapWorkflowDef } from './qaap-workflow-ir';

/** Per-run knobs a caller may set on a template without being able to author the graph itself. */
export interface QaapWorkflowTemplateOptions {
    /** Insert the graph-level verification step and its fix-loop (see `QaapStartWorkflowRequest`). */
    readonly verify?: boolean;
}

export interface QaapWorkflowTemplate {
    readonly summary: QaapWorkflowTemplateSummary;
    /** Build the immutable definition for one run. */
    build(options?: QaapWorkflowTemplateOptions): QaapWorkflowDef;
}

export class QaapWorkflowTemplateRegistry {

    protected readonly templates = new Map<string, QaapWorkflowTemplate>();

    constructor() {
        this.registerBuiltins();
    }

    register(template: QaapWorkflowTemplate): void {
        if (this.templates.has(template.summary.id)) {
            throw new Error(`Duplicate workflow template id: ${template.summary.id}`);
        }
        this.templates.set(template.summary.id, template);
    }

    get(id: string): QaapWorkflowTemplate | undefined {
        return this.templates.get(id);
    }

    list(): QaapWorkflowTemplateSummary[] {
        return [...this.templates.values()]
            .map(template => template.summary)
            .sort((left, right) => left.name.localeCompare(right.name));
    }

    protected registerBuiltins(): void {
        this.register({
            summary: {
                id: 'qaap.implement-then-review',
                name: 'Implement, then adversarial review',
                description:
                    'Implements the task, classifies the change risk, and runs an independent adversarial review only when the diff is high-risk.',
                requiredInputs: ['task'],
            },
            // Match the deployment's configured review mode so a started run behaves like the
            // runner's own review under the same QAAP_AGENT_REVIEW setting.
            build: options => buildImplementThenReviewWorkflow({
                reviewMode: resolveAgentReviewMode(this.reviewModeEnv()),
                withVerify: options?.verify,
            }),
        });

        this.register({
            summary: {
                id: 'qaap.goal',
                name: 'Work until the goal check passes',
                description:
                    'Works toward a declared goal and does not finish until its success check — an npm script of your choosing, '
                    + 'or the repository\'s own verification scripts — exits 0, re-entering a fix turn each time it fails.',
                requiredInputs: ['task'],
            },
            // How many fix turns a goal may take is the run's own budget (`maxVisitsPerNode`) and
            // its wall clock — one set of bounds, not a second private one that could disagree.
            build: () => buildImplementThenReviewWorkflow({
                reviewMode: resolveAgentReviewMode(this.reviewModeEnv()),
                withGoal: true,
            }),
        });

        this.register({
            summary: {
                id: 'qaap.plan-then-implement',
                name: 'Plan first, implement after approval',
                description:
                    'Proposes a plan read-only, pauses for a person to approve it, and only then implements it — '
                    + 'the approved plan travels into the implementing turn.',
                requiredInputs: ['task'],
            },
            build: options => buildImplementThenReviewWorkflow({
                reviewMode: resolveAgentReviewMode(this.reviewModeEnv()),
                withVerify: options?.verify,
                withPlan: true,
            }),
        });

        this.register({
            summary: {
                id: 'qaap.explore-then-implement',
                name: 'Explore in parallel, then implement and review',
                description:
                    'Runs two read-only explorers at once — where the change belongs, and how the repository is verified — '
                    + 'hands their findings to the implement turn, then classifies risk and reviews as usual.',
                requiredInputs: ['task'],
            },
            build: options => buildImplementThenReviewWorkflow({
                reviewMode: resolveAgentReviewMode(this.reviewModeEnv()),
                withVerify: options?.verify,
                withParallelExploration: true,
            }),
        });

        this.registerOptionalTopologies();
    }

    /**
     * Opt-in topologies. Both cost more than the default shape — one multiplies the review, the
     * other adds a turn before any code is written — so they are separate template ids a caller
     * chooses, never a change of behaviour for the templates above.
     */
    protected registerOptionalTopologies(): void {
        this.register({
            summary: {
                id: 'qaap.multi-lens-review',
                name: 'Implement, then review through three lenses',
                description:
                    'Implements the task, then reviews the diff through three independent lenses at once — correctness, safety '
                    + 'and whether it does what was asked — and lets a synthesis step weigh their findings into a single verdict. '
                    + 'Costs one review turn per lens plus the synthesis.',
                requiredInputs: ['task'],
            },
            build: options => buildImplementThenReviewWorkflow({
                // Still the deployment's review mode: a caller asking for more review does not get
                // to switch reviewing back ON where the operator turned it off.
                reviewMode: resolveAgentReviewMode(this.reviewModeEnv()),
                withVerify: options?.verify,
                withMultiLensReview: true,
            }),
        });

        this.register({
            summary: {
                id: 'qaap.plan-gate-then-implement',
                name: 'Plan, review the plan, then implement',
                description:
                    'Proposes a plan read-only and has an independent judge accept or reject it BEFORE anything is written. '
                    + 'A rejected plan is rewritten against the reviewer\'s objections; only an accepted plan reaches the '
                    + 'implementing turn, which then classifies risk and reviews as usual.',
                requiredInputs: ['task'],
            },
            build: options => buildImplementThenReviewWorkflow({
                reviewMode: resolveAgentReviewMode(this.reviewModeEnv()),
                withVerify: options?.verify,
                withPlanGate: true,
            }),
        });
    }

    /** Isolated for tests; the live registry reads the process env. */
    protected reviewModeEnv(): string | undefined {
        return process.env.QAAP_AGENT_REVIEW;
    }
}
