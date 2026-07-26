// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Resolves a node's `promptRef` into the text an agent turn actually receives (ADR-001).
 *
 * Refs are an allowlist, not free-form text: a workflow definition can travel from a template, an
 * import or (later) a model-authored graph, so letting `promptRef` be an arbitrary prompt would
 * turn workflow authoring into prompt injection with the run's own credentials and cwd.
 */

import { buildAgentReviewPrompt } from './qaap-agent-review';
import {
    QAAP_WORKFLOW_REVIEW_DIFF_ARTIFACT,
    QAAP_WORKFLOW_STRUCTURE_ARTIFACT,
    QAAP_WORKFLOW_VERIFICATION_ARTIFACT,
} from './qaap-workflow-ir';

export interface QaapWorkflowPromptContext {
    /** Values captured when the run started, e.g. `{ task: 'fix the login bug' }`. */
    readonly inputs: Readonly<Record<string, string>>;
    /** Binding keys emitted by earlier nodes, e.g. `review.passed`. */
    readonly bindings: Readonly<Record<string, string>>;
    /** Text earlier deterministic nodes produced, e.g. the captured diff under `review.diff`. */
    readonly artifacts?: Readonly<Record<string, string>>;
}

export type QaapWorkflowPromptTemplate = (context: QaapWorkflowPromptContext) => string;

export class QaapWorkflowPromptError extends Error { }

const REQUIRED_INPUT_MISSING = (ref: string, key: string): string =>
    `Workflow prompt "${ref}" requires input "${key}".`;

function requireInput(ref: string, context: QaapWorkflowPromptContext, key: string): string {
    const value = context.inputs[key]?.trim();
    if (!value) {
        throw new QaapWorkflowPromptError(REQUIRED_INPUT_MISSING(ref, key));
    }
    return value;
}

/** Allowlisted prompt templates addressable from a workflow definition. */
export class QaapWorkflowPromptRegistry {

    protected readonly templates = new Map<string, QaapWorkflowPromptTemplate>();

    constructor() {
        this.registerBuiltins();
    }

    register(ref: string, template: QaapWorkflowPromptTemplate): void {
        if (this.templates.has(ref)) {
            throw new QaapWorkflowPromptError(`Duplicate workflow prompt ref: ${ref}`);
        }
        this.templates.set(ref, template);
    }

    has(ref: string): boolean {
        return this.templates.has(ref);
    }

    resolve(ref: string, context: QaapWorkflowPromptContext): string {
        const template = this.templates.get(ref);
        if (!template) {
            throw new QaapWorkflowPromptError(`Unknown workflow prompt ref: ${ref}`);
        }
        return template(context);
    }

    protected registerBuiltins(): void {
        this.register('user-task', context => requireInput('user-task', context, 'task'));

        // Two read-only explorers with DIFFERENT lenses, so the fan-out buys coverage instead of
        // the same answer twice: one maps where the change belongs, the other how it is verified.
        this.register('explore-structure', context => [
            'Explore this repository READ-ONLY. Do not edit, create or delete any file.',
            'Report, in at most 15 lines: the files and functions a change for the task below would touch, with paths;',
            'the conventions that change must follow; and anything that looks like a trap (duplicated logic, callers that would break).',
            '',
            `Task: ${requireInput('explore-structure', context, 'task')}`,
        ].join('\n'));

        this.register('explore-verification', context => [
            'Explore this repository READ-ONLY. Do not edit, create or delete any file.',
            'Report, in at most 15 lines: the exact commands that verify a change here (scripts, test runner, lint),',
            'which existing tests cover the area of the task below, and what a new test for it would have to assert.',
            '',
            `Task: ${requireInput('explore-verification', context, 'task')}`,
        ].join('\n'));

        // The implement turn is the whole point of the fan-out: it starts already knowing the map.
        this.register('implement-with-findings', context => {
            const structure = context.artifacts?.[QAAP_WORKFLOW_STRUCTURE_ARTIFACT]?.trim();
            const verification = context.artifacts?.[QAAP_WORKFLOW_VERIFICATION_ARTIFACT]?.trim();
            const findings = [
                structure && `Where the change belongs (from a read-only explorer):\n${structure}`,
                verification && `How this repository is verified (from a read-only explorer):\n${verification}`,
            ].filter(Boolean);
            return [
                requireInput('implement-with-findings', context, 'task'),
                ...(findings.length > 0
                    ? [
                        '',
                        '---',
                        'Two explorers already read this repository for you. Treat their notes as leads to confirm, not as facts:',
                        '',
                        ...findings,
                    ]
                    : []),
            ].join('\n');
        });

        this.register('fix-verification', context => [
            'The previous turn left the workspace failing its own verification.',
            'Fix it, changing as little as possible.',
            '',
            `Original task: ${requireInput('fix-verification', context, 'task')}`,
        ].join('\n'));

        // Reuse the runner's reviewer prompt so the @@QAAP:VERDICT@@ contract lives in exactly one
        // place. A judge node declares requireSentinel, and without this instruction a faithful
        // reviewer writes prose, emits no marker, and every review lands inconclusive — observed
        // live with the claude backend. The diff comes from the `git-diff` node's artifact; when it
        // is missing the prompt's empty-diff branch tells the reviewer to inspect the tree itself.
        this.register('adversarial-review', context => buildAgentReviewPrompt({
            originalCommand: requireInput('adversarial-review', context, 'task'),
            diff: context.artifacts?.[QAAP_WORKFLOW_REVIEW_DIFF_ARTIFACT] ?? '',
        }));
    }
}
