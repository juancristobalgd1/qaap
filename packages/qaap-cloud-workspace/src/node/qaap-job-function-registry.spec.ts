// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapBuiltinJobFunctions, QaapJobFunctionRegistry } from './qaap-job-function-registry';

describe('QaapJobFunctionRegistry', () => {

    function buildRegistry(): QaapJobFunctionRegistry {
        const registry = Object.create(QaapJobFunctionRegistry.prototype) as QaapJobFunctionRegistry;
        Object.assign(registry, { definitions: new Map() });
        return registry;
    }

    it('registers and lists the built-in typed workspace functions', () => {
        const registry = buildRegistry();
        new QaapBuiltinJobFunctions().registerFunctions(registry);

        expect(registry.list().map(descriptor => descriptor.id)).to.deep.equal([
            'qaap.workspace.package-manifest',
            'qaap.workspace.read-json',
        ]);
        expect(registry.list()[0].inputSchema).to.deep.include({ type: 'object' });
    });

    it('normalizes input and returns structured package metadata', async () => {
        const registry = buildRegistry();
        new QaapBuiltinJobFunctions().registerFunctions(registry);
        const definition = registry.get('qaap.workspace.package-manifest')!;
        const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-job-function-'));
        try {
            fs.writeFileSync(path.join(temporaryRoot, 'package.json'), JSON.stringify({
                name: 'example', version: '1.2.3', private: true,
                scripts: { test: 'mocha' }, dependencies: { chai: '1.0.0' },
            }));
            const controller = new AbortController();
            const input = definition.normalizeInput({ includeDependencies: true });
            const result = await definition.execute({
                jobId: 'job', cwd: temporaryRoot, signal: controller.signal,
                emitOutput: () => undefined,
                resolveWorkspacePath: async relativePath => path.join(temporaryRoot, relativePath),
            }, input) as Record<string, unknown>;

            expect(result.name).to.equal('example');
            expect(result.scripts).to.deep.equal({ test: 'mocha' });
            expect(result.dependencies).to.deep.equal({ chai: '1.0.0' });
        } finally {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        }
    });

    it('rejects unknown input keys instead of silently accepting a changed contract', () => {
        const registry = buildRegistry();
        new QaapBuiltinJobFunctions().registerFunctions(registry);
        const definition = registry.get('qaap.workspace.package-manifest')!;

        expect(() => definition.normalizeInput({ unexpected: true })).to.throw('Invalid package manifest input');
    });

    it('reads one structured value from a bounded workspace JSON file', async () => {
        const registry = buildRegistry();
        new QaapBuiltinJobFunctions().registerFunctions(registry);
        const definition = registry.get('qaap.workspace.read-json')!;
        const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-job-function-'));
        try {
            fs.writeFileSync(path.join(temporaryRoot, 'metrics.json'), JSON.stringify({ quality: { score: 93 } }));
            const input = definition.normalizeInput({ path: 'metrics.json', pointer: '/quality/score' });
            const result = await definition.execute({
                jobId: 'job', cwd: temporaryRoot, signal: new AbortController().signal,
                emitOutput: () => undefined,
                resolveWorkspacePath: async relativePath => path.join(temporaryRoot, relativePath),
            }, input);

            expect(result).to.deep.equal({ value: 93 });
        } finally {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        }
    });

    it('rejects absolute JSON paths and missing JSON Pointers', async () => {
        const registry = buildRegistry();
        new QaapBuiltinJobFunctions().registerFunctions(registry);
        const definition = registry.get('qaap.workspace.read-json')!;
        expect(() => definition.normalizeInput({ path: '/etc/passwd' })).to.throw('Invalid workspace JSON input');
        expect(() => definition.normalizeInput({ path: 'metrics.json', pointer: '/bad~2escape' }))
            .to.throw('Invalid workspace JSON input');

        const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-job-function-'));
        try {
            fs.writeFileSync(path.join(temporaryRoot, 'metrics.json'), '{}');
            const input = definition.normalizeInput({ path: 'metrics.json', pointer: '/missing' });
            let rejected: unknown;
            try {
                await definition.execute({
                    jobId: 'job', cwd: temporaryRoot, signal: new AbortController().signal,
                    emitOutput: () => undefined,
                    resolveWorkspacePath: async relativePath => path.join(temporaryRoot, relativePath),
                }, input);
            } catch (error) {
                rejected = error;
            }
            expect((rejected as Error).message).to.contain('JSON Pointer was not found');
        } finally {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        }
    });
});
