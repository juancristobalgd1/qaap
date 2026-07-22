// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapJobLoopTemplate } from '../common/qaap-job-loop-template';
import { QaapJobLoopTemplateEndpoint } from './qaap-job-loop-template-endpoint';

interface FakeResponse {
    statusCode: number;
    body: unknown;
    status(code: number): FakeResponse;
    json(body: unknown): FakeResponse;
    end(): FakeResponse;
}

const response = (): FakeResponse => ({
    statusCode: 200,
    body: undefined,
    status(code: number): FakeResponse { this.statusCode = code; return this; },
    json(body: unknown): FakeResponse { this.body = body; return this; },
    end(): FakeResponse { return this; },
});

const template: QaapJobLoopTemplate = {
    id: 'template-1', ownerLogin: 'alice', name: 'Quality loop', revision: 1, createdAt: 1, updatedAt: 1,
    definition: {
        title: 'Quality loop',
        graph: { nodes: [{ key: 'measure', request: { command: 'measure', cwd: 'org/repo' } }] },
        until: { nodeKey: 'measure', pointer: '/score', operator: 'greater_or_equal', expected: 90 },
    },
};

describe('QaapJobLoopTemplateEndpoint', () => {
    it('canonicalizes definitions before creating and importing templates', async () => {
        const endpoint = Object.create(QaapJobLoopTemplateEndpoint.prototype) as QaapJobLoopTemplateEndpoint;
        const definitions: Array<{ operation: string; cwd: string }> = [];
        Object.assign(endpoint, {
            engine: { validate: () => undefined },
            store: {
                create: (request: { definition: QaapJobLoopTemplate['definition'] }) => {
                    definitions.push({ operation: 'create', cwd: request.definition.graph.nodes[0].request.cwd });
                    return Promise.resolve(template);
                },
                import: (request: { document: { template: { definition: QaapJobLoopTemplate['definition'] } } }) => {
                    definitions.push({ operation: 'import', cwd: request.document.template.definition.graph.nodes[0].request.cwd });
                    return Promise.resolve({ template, created: true });
                },
            },
            auth: {
                authenticate: () => ({ kind: 'skip', userLogin: 'trigger-owner' }),
                resolveOwnedRepositoryCwd: (_context: unknown, cwd: string) => ({ kind: 'ok', cwd: `/canonical/${cwd}` }),
            },
        });

        await (endpoint as unknown as { handleCreate(req: unknown, res: unknown): Promise<void> }).handleCreate({
            body: { name: template.name, definition: template.definition },
        }, response());
        await (endpoint as unknown as { handleImport(req: unknown, res: unknown): Promise<void> }).handleImport({
            body: { document: { format: 'qaap.job-loop-template', version: 1, template: { name: template.name, definition: template.definition } } },
        }, response());

        expect(definitions).to.deep.equal([
            { operation: 'create', cwd: '/canonical/org/repo' },
            { operation: 'import', cwd: '/canonical/org/repo' },
        ]);
    });

    it('does not persist a template whose workspace is forbidden', async () => {
        const endpoint = Object.create(QaapJobLoopTemplateEndpoint.prototype) as QaapJobLoopTemplateEndpoint;
        let persisted = false;
        Object.assign(endpoint, {
            store: { create: () => { persisted = true; return Promise.resolve(template); } },
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                resolveOwnedRepositoryCwd: () => ({ kind: 'denied' }),
            },
        });
        const res = response();

        await (endpoint as unknown as { handleCreate(req: unknown, res: unknown): Promise<void> }).handleCreate({
            body: { name: template.name, definition: template.definition },
        }, res);

        expect(res.statusCode).to.equal(403);
        expect(persisted).to.equal(false);
    });

    it('canonicalizes every template CWD and runs under the authenticated owner', async () => {
        const endpoint = Object.create(QaapJobLoopTemplateEndpoint.prototype) as QaapJobLoopTemplateEndpoint;
        let captured: { owner?: string; cwd?: string; key?: string } = {};
        Object.assign(endpoint, {
            store: { get: (owner: string | undefined, id: string) => owner === 'alice' && id === template.id ? template : undefined },
            engine: {
                validate: () => undefined,
                create: (definition: { graph: { nodes: Array<{ request: { cwd: string } }> }; idempotencyKey?: string }, owner?: string) => {
                    captured = { owner, cwd: definition.graph.nodes[0].request.cwd, key: definition.idempotencyKey };
                    return Promise.resolve({ loop: { id: 'loop-1' }, created: true });
                },
            },
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                resolveOwnedRepositoryCwd: (_context: unknown, cwd: string) => ({ kind: 'ok', cwd: `/repos/alice/${cwd}` }),
            },
        });
        const res = response();

        await (endpoint as unknown as { handleRun(req: unknown, res: unknown): Promise<void> }).handleRun({
            params: { id: template.id }, body: { idempotencyKey: 'run:42' }, header: () => undefined,
        }, res);

        expect(res.statusCode).to.equal(201);
        expect(captured).to.deep.equal({ owner: 'alice', cwd: '/repos/alice/org/repo', key: 'run:42' });
    });

    it('rejects mismatched idempotency keys before running the engine', async () => {
        const endpoint = Object.create(QaapJobLoopTemplateEndpoint.prototype) as QaapJobLoopTemplateEndpoint;
        let run = false;
        Object.assign(endpoint, {
            store: { get: () => template },
            engine: { create: () => { run = true; return Promise.resolve(undefined); } },
            auth: { authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }) },
        });
        const res = response();

        await (endpoint as unknown as { handleRun(req: unknown, res: unknown): Promise<void> }).handleRun({
            params: { id: template.id }, body: { idempotencyKey: 'body' }, header: () => 'header',
        }, res);

        expect(res.statusCode).to.equal(400);
        expect(run).to.equal(false);
    });

    it('returns only the safe portable export document', () => {
        const endpoint = Object.create(QaapJobLoopTemplateEndpoint.prototype) as QaapJobLoopTemplateEndpoint;
        Object.assign(endpoint, {
            store: { export: () => ({ format: 'qaap.job-loop-template', version: 1, template: { name: template.name, definition: template.definition } }) },
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                userWorkspaceRoot: () => undefined,
            },
        });
        const res = response();

        (endpoint as unknown as { handleExport(req: unknown, res: unknown): void }).handleExport({ params: { id: template.id } }, res);

        expect(res.body).not.to.have.any.keys('id', 'ownerLogin', 'createdAt', 'updatedAt', 'revision');
    });
});
