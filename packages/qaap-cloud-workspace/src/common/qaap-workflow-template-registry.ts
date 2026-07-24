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
            build: () => buildImplementThenReviewWorkflow(),
        });
    }
}
