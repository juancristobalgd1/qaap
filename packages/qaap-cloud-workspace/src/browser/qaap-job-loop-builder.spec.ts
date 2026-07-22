// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    createQaapJobLoopDraft,
    qaapJobLoopDefinitionToDraft,
    qaapJobLoopDraftToTemplateRequest,
    validateQaapJobLoopDraft,
} from './qaap-job-loop-builder';

describe('QaapJobLoopBuilder validation', () => {

    it('accepts a bounded command loop with a unary condition', () => {
        const draft = createQaapJobLoopDraft('/workspace/repo');
        const node = { ...draft.nodes[0], command: 'npm test' };
        const validation = validateQaapJobLoopDraft({ ...draft, nodes: [node] });

        expect(validation.valid).to.equal(true);
    });

    it('rejects duplicate node keys and cyclic dependencies', () => {
        const draft = createQaapJobLoopDraft('/workspace/repo');
        const first = { ...draft.nodes[0], key: 'same', command: 'first', dependsOn: ['other'] };
        const second = { ...draft.nodes[0], id: 'second', key: 'same', command: 'second', dependsOn: ['same'] };
        const validation = validateQaapJobLoopDraft({ ...draft, nodes: [first, second], conditionNodeKey: 'same' });

        expect(validation.valid).to.equal(false);
        expect(validation.errors['node-second-key']).to.not.equal(undefined);
        expect(validation.errors.graph).to.not.equal(undefined);
    });

    it('requires valid JSON and a finite number for numeric conditions', () => {
        const draft = createQaapJobLoopDraft('/workspace/repo');
        const node = { ...draft.nodes[0], kind: 'function' as const, functionId: 'test.function', input: '{' };
        const validation = validateQaapJobLoopDraft({
            ...draft,
            nodes: [node],
            conditionOperator: 'greater_than',
            conditionExpected: '"not-a-number"',
        });

        expect(validation.valid).to.equal(false);
        expect(validation.errors[`node-${node.id}-input`]).to.not.equal(undefined);
        expect(validation.errors.conditionExpected).to.not.equal(undefined);
    });

    it('creates a reusable definition without execution idempotency', () => {
        const draft = createQaapJobLoopDraft('/workspace/repo');
        const request = qaapJobLoopDraftToTemplateRequest({
            ...draft,
            title: '  Verify workspace  ',
            templateDescription: '  Runs the workspace verification graph.  ',
            idempotencyKey: 'one-execution-only',
            nodes: [{ ...draft.nodes[0], command: 'npm test' }],
        });

        expect(request.name).to.equal('Verify workspace');
        expect(request.description).to.equal('Runs the workspace verification graph.');
        expect(request.definition).to.not.have.property('idempotencyKey');
    });

    it('opens a stored typed-function definition as an editable draft', () => {
        const draft = qaapJobLoopDefinitionToDraft({
            graph: { nodes: [{
                key: 'inspect',
                request: { kind: 'function', functionId: 'qaap.inspect', input: { depth: 2 }, cwd: '/workspace/repo' },
                bindings: [{ from: { nodeKey: 'inspect', pointer: '/next' }, targetPointer: '/depth' }],
            }] },
            until: { nodeKey: 'inspect', operator: 'equals', expected: 'done' },
            maxIterations: 3,
            maxDurationMs: 120_000,
        }, 'Inspect workspace', 'Reads the package graph');

        expect(draft).to.include({ title: 'Inspect workspace', templateDescription: 'Reads the package graph', cwd: '/workspace/repo', maxIterations: '3', maxDurationMinutes: '2' });
        expect(draft.nodes[0]).to.include({ kind: 'function', functionId: 'qaap.inspect', input: '{\n  "depth": 2\n}' });
        expect(draft.nodes[0].bindings[0]).to.include({ nodeKey: 'inspect', pointer: '/next', targetPointer: '/depth' });
    });
});
