// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { validateQaapWorkflowDef } from './qaap-workflow-ir';
import { QaapWorkflowTemplateRegistry } from './qaap-workflow-template-registry';

describe('QaapWorkflowTemplateRegistry', () => {
    let registry: QaapWorkflowTemplateRegistry;

    beforeEach(() => registry = new QaapWorkflowTemplateRegistry());

    it('exposes the implement-then-review template without leaking prompt bodies', () => {
        const list = registry.list();
        const summary = list.find(entry => entry.id === 'qaap.implement-then-review');
        expect(summary).to.not.equal(undefined);
        expect(summary?.requiredInputs).to.deep.equal(['task']);
        expect(JSON.stringify(summary)).to.not.contain('@@QAAP');
    });

    it('builds a valid definition for every registered template', () => {
        for (const summary of registry.list()) {
            const def = registry.get(summary.id)!.build();
            expect(validateQaapWorkflowDef(def), summary.id).to.deep.include({ ok: true });
        }
    });

    it('returns undefined for an unknown id instead of throwing', () => {
        expect(registry.get('nope')).to.equal(undefined);
    });

    it('refuses to register a duplicate id', () => {
        const template = registry.get('qaap.implement-then-review')!;
        expect(() => registry.register(template)).to.throw(/Duplicate/);
    });
});
