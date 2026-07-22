// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContributionProvider, nls } from '@theia/core';
import { inject, injectable, named, postConstruct } from '@theia/core/shared/inversify';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { isValidQaapJsonPointer, resolveQaapJsonPointer } from '../common/qaap-json-pointer';
import { QaapJobFunctionDescriptor } from '../common/qaap-job';

export const QaapJobFunctionContribution = Symbol('QaapJobFunctionContribution');

export interface QaapJobFunctionContext {
    readonly jobId: string;
    readonly cwd: string;
    readonly ownerLogin?: string;
    readonly signal: AbortSignal;
    readonly emitOutput: (chunk: string) => void;
    /** Resolve an existing relative path and reject symlink traversal outside the job workspace. */
    readonly resolveWorkspacePath: (relativePath: string) => Promise<string>;
}

export interface QaapJobFunctionDefinition<TInput = unknown, TOutput = unknown> {
    readonly descriptor: QaapJobFunctionDescriptor;
    /** Validate untrusted JSON and return the normalized, typed input passed to `execute`. */
    readonly normalizeInput: (input: unknown) => TInput;
    readonly execute: (context: QaapJobFunctionContext, input: TInput) => Promise<TOutput>;
}

export interface QaapJobFunctionContribution {
    registerFunctions(registry: QaapJobFunctionRegistry): void;
}

/** Extensible allowlist of typed backend functions available to QaapJobRuntime. */
@injectable()
export class QaapJobFunctionRegistry {

    @inject(ContributionProvider) @named(QaapJobFunctionContribution)
    protected readonly contributions: ContributionProvider<QaapJobFunctionContribution>;

    protected readonly definitions = new Map<string, QaapJobFunctionDefinition>();

    @postConstruct()
    protected init(): void {
        for (const contribution of this.contributions.getContributions()) {
            contribution.registerFunctions(this);
        }
    }

    register<TInput, TOutput>(definition: QaapJobFunctionDefinition<TInput, TOutput>): void {
        const id = definition.descriptor.id.trim();
        if (!/^[a-z][a-z0-9.-]{2,127}$/.test(id)) {
            throw new Error(`Invalid Qaap job function id: ${id}`);
        }
        if (this.definitions.has(id)) {
            throw new Error(`Duplicate Qaap job function id: ${id}`);
        }
        this.definitions.set(id, definition as QaapJobFunctionDefinition);
    }

    get(id: string): QaapJobFunctionDefinition | undefined {
        return this.definitions.get(id);
    }

    list(): QaapJobFunctionDescriptor[] {
        return [...this.definitions.values()]
            .map(definition => definition.descriptor)
            .sort((left, right) => left.id.localeCompare(right.id));
    }
}

interface PackageManifestInput {
    readonly includeDependencies: boolean;
}

interface ReadJsonInput {
    readonly path: string;
    readonly pointer: string;
}

/** Small built-in function proving the typed extension path without shelling out or invoking AI. */
@injectable()
export class QaapBuiltinJobFunctions implements QaapJobFunctionContribution {

    registerFunctions(registry: QaapJobFunctionRegistry): void {
        registry.register<PackageManifestInput, Readonly<Record<string, unknown>>>({
            descriptor: {
                id: 'qaap.workspace.package-manifest',
                label: nls.localize('qaap/jobs/functions/packageManifestLabel', 'Read package manifest'),
                description: nls.localize(
                    'qaap/jobs/functions/packageManifestDescription',
                    'Reads structured package metadata from package.json without starting an agent or shell.',
                ),
                resourceClass: 'io',
                workspaceAccess: 'read',
                inputSchema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { includeDependencies: { type: 'boolean', default: false } },
                },
                outputSchema: { type: 'object' },
            },
            normalizeInput: input => {
                if (input === undefined) {
                    return { includeDependencies: false };
                }
                if (!input || typeof input !== 'object' || Array.isArray(input)) {
                    throw new Error(nls.localize('qaap/jobs/functions/inputMustBeObject', 'Function input must be an object.'));
                }
                const record = input as Record<string, unknown>;
                const unknownKeys = Object.keys(record).filter(key => key !== 'includeDependencies');
                if (unknownKeys.length > 0 || (record.includeDependencies !== undefined && typeof record.includeDependencies !== 'boolean')) {
                    throw new Error(nls.localize('qaap/jobs/functions/invalidPackageManifestInput', 'Invalid package manifest input.'));
                }
                return { includeDependencies: record.includeDependencies === true };
            },
            execute: async (context, input) => {
                if (context.signal.aborted) {
                    throw context.signal.reason ?? new Error('Aborted');
                }
                const filePath = await context.resolveWorkspacePath('package.json');
                const raw = await fsp.readFile(filePath, 'utf8');
                if (raw.length > 512 * 1024) {
                    throw new Error(nls.localize('qaap/jobs/functions/packageManifestTooLarge', 'package.json is too large.'));
                }
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                const result: Record<string, unknown> = {
                    name: parsed.name,
                    version: parsed.version,
                    private: parsed.private,
                    scripts: parsed.scripts,
                };
                if (input.includeDependencies) {
                    result.dependencies = parsed.dependencies;
                    result.devDependencies = parsed.devDependencies;
                }
                return result;
            },
        });
        registry.register<ReadJsonInput, { readonly value: unknown }>({
            descriptor: {
                id: 'qaap.workspace.read-json',
                label: nls.localize('qaap/jobs/functions/readJsonLabel', 'Read workspace JSON'),
                description: nls.localize(
                    'qaap/jobs/functions/readJsonDescription',
                    'Reads a bounded JSON file or one JSON Pointer value without starting an agent or shell.',
                ),
                resourceClass: 'io',
                workspaceAccess: 'read',
                inputSchema: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['path'],
                    properties: {
                        path: { type: 'string', minLength: 1, maxLength: 4_096 },
                        pointer: { type: 'string', maxLength: 1_024, default: '' },
                    },
                },
                outputSchema: {
                    type: 'object',
                    required: ['value'],
                    properties: { value: {} },
                },
            },
            normalizeInput: input => {
                if (!input || typeof input !== 'object' || Array.isArray(input)) {
                    throw new Error(nls.localize('qaap/jobs/functions/inputMustBeObject', 'Function input must be an object.'));
                }
                const record = input as Record<string, unknown>;
                const unknownKeys = Object.keys(record).filter(key => key !== 'path' && key !== 'pointer');
                const filePath = typeof record.path === 'string' ? record.path.trim() : '';
                const pointer = record.pointer === undefined ? '' : record.pointer;
                if (
                    unknownKeys.length > 0 || !filePath || filePath.length > 4_096 || path.isAbsolute(filePath)
                    || filePath.includes('\0') || !isValidQaapJsonPointer(pointer)
                ) {
                    throw new Error(nls.localize('qaap/jobs/functions/invalidReadJsonInput', 'Invalid workspace JSON input.'));
                }
                return { path: filePath, pointer };
            },
            execute: async (context, input) => {
                if (context.signal.aborted) {
                    throw context.signal.reason ?? new Error('Aborted');
                }
                const filePath = await context.resolveWorkspacePath(input.path);
                const stat = await fsp.stat(filePath);
                if (!stat.isFile() || stat.size > 512 * 1024) {
                    throw new Error(nls.localize(
                        'qaap/jobs/functions/jsonFileTooLarge',
                        'The JSON file must be a regular file no larger than 512 KiB.',
                    ));
                }
                const raw = await fsp.readFile(filePath, 'utf8');
                if (Buffer.byteLength(raw, 'utf8') > 512 * 1024) {
                    throw new Error(nls.localize(
                        'qaap/jobs/functions/jsonFileTooLarge',
                        'The JSON file must be a regular file no larger than 512 KiB.',
                    ));
                }
                if (context.signal.aborted) {
                    throw context.signal.reason ?? new Error('Aborted');
                }
                let parsed: unknown;
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    throw new Error(nls.localize('qaap/jobs/functions/invalidJsonFile', 'The workspace file is not valid JSON.'));
                }
                const resolved = resolveQaapJsonPointer(parsed, input.pointer);
                if (!resolved.found) {
                    throw new Error(nls.localize('qaap/jobs/functions/jsonPointerNotFound', 'The JSON Pointer was not found.'));
                }
                return { value: resolved.value };
            },
        });
    }
}
