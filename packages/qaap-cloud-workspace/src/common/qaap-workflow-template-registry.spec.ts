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

    it('builds a valid definition for every registered template, with and without verify', () => {
        for (const summary of registry.list()) {
            for (const verify of [false, true]) {
                const def = registry.get(summary.id)!.build({ verify });
                expect(validateQaapWorkflowDef(def), `${summary.id} verify=${verify}`).to.deep.include({ ok: true });
            }
        }
    });

    it('reaches the verification fix-loop when a caller asks for it', () => {
        // The loop existed and was tested, but nothing could turn it on: the registry always built
        // the graph without it, so `withVerify` was dead code from the API's point of view.
        const withoutVerify = registry.get('qaap.implement-then-review')!.build();
        expect(withoutVerify.nodes.map(node => node.id)).to.not.include('verify');

        const withVerify = registry.get('qaap.implement-then-review')!.build({ verify: true });
        expect(withVerify.nodes.map(node => node.id)).to.include.members(['verify', 'implement-fix']);
        expect(withVerify.edges).to.deep.include({ from: 'verify', to: 'implement-fix', when: 'fail' });
        expect(withVerify.edges).to.deep.include({ from: 'implement-fix', to: 'verify', when: 'success' });
    });

    it('returns undefined for an unknown id instead of throwing', () => {
        expect(registry.get('nope')).to.equal(undefined);
    });

    it('refuses to register a duplicate id', () => {
        const template = registry.get('qaap.implement-then-review')!;
        expect(() => registry.register(template)).to.throw(/Duplicate/);
    });
});
