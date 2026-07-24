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

export interface QaapWorkflowTemplate {
    readonly summary: QaapWorkflowTemplateSummary;
    /** Build the immutable definition for one run. */
    build(): QaapWorkflowDef;
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
            build: () => buildImplementThenReviewWorkflow({
                reviewMode: resolveAgentReviewMode(this.reviewModeEnv()),
            }),
        });
    }

    /** Isolated for tests; the live registry reads the process env. */
    protected reviewModeEnv(): string | undefined {
        return process.env.QAAP_AGENT_REVIEW;
    }
}
