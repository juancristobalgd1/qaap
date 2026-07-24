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

        // The reviewer prompt proper (with the inlined diff) is built by the review adapter from
        // the git-diff binding; this ref only carries the framing, so the sentinel contract stays
        // in one place: qaap-agent-review.
        this.register('adversarial-review', context => [
            'Review the change in this workspace adversarially, as an independent second agent.',
            'Judge the actual diff, not the description of it.',
            '',
            `Task under review: ${requireInput('adversarial-review', context, 'task')}`,
            context.bindings['review.diff'] ? `Diff artifact: ${context.bindings['review.diff']}` : '',
        ].filter(Boolean).join('\n'));
    }
}
