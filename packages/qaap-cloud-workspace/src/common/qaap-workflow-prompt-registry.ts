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

export interface QaapWorkflowPromptContext {
    /** Values captured when the run started, e.g. `{ task: 'fix the login bug' }`. */
    readonly inputs: Readonly<Record<string, string>>;
    /** Artifact references emitted by earlier nodes. */
    readonly bindings: Readonly<Record<string, string>>;
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

        this.register('fix-verification', context => [
            'The previous turn left the workspace failing its own verification.',
            'Fix it, changing as little as possible.',
            '',
            `Original task: ${requireInput('fix-verification', context, 'task')}`,
        ].join('\n'));

        // Reuse the runner's reviewer prompt so the @@QAAP:VERDICT@@ contract lives in exactly one
        // place. A judge node declares requireSentinel, and without this instruction a faithful
        // reviewer writes prose, emits no marker, and every review lands inconclusive — observed
        // live with the claude backend. The diff is not inlined (bindings hold refs, not bodies);
        // the prompt's empty-diff branch tells the reviewer to inspect the working tree itself.
        this.register('adversarial-review', context => {
            const prompt = buildAgentReviewPrompt({
                originalCommand: requireInput('adversarial-review', context, 'task'),
                diff: '',
            });
            const diffRef = context.bindings['review.diff'];
            return diffRef ? `${prompt}\nDiff artifact: ${diffRef}` : prompt;
        });
    }
}
