// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Emitter, Event, nls } from '@theia/core';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    QAAP_JOB_LOOP_TEMPLATE_EXPORT_FORMAT,
    QAAP_JOB_LOOP_TEMPLATE_EXPORT_VERSION,
    QaapCreateJobLoopTemplateRequest,
    QaapImportJobLoopTemplateRequest,
    QaapImportJobLoopTemplateResult,
    QaapJobLoopTemplate,
    QaapJobLoopTemplateDefinition,
    QaapJobLoopTemplateExport,
    QaapUpdateJobLoopTemplateRequest,
} from '../common/qaap-job-loop-template';
import { writeJsonAtomic } from './qaap-write-json-atomic';

const STORE_MODE = 0o700;
const INDEX_MODE = 0o600;
const MAX_TEMPLATES_PER_OWNER = 100;
const MAX_NAME_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 4096;
const MAX_DEFINITION_BYTES = 256 * 1024;

interface PersistedTemplateIndex {
    readonly version: 1;
    readonly templates: readonly QaapJobLoopTemplate[];
}

export class QaapJobLoopTemplateRequestError extends Error { }
export class QaapJobLoopTemplateConflictError extends Error { }

/** Durable, atomic, owner-scoped storage for reusable loop definitions. */
@injectable()
export class QaapJobLoopTemplateStore {

    protected readonly templates = new Map<string, QaapJobLoopTemplate>();
    protected mutationChain: Promise<void> = Promise.resolve();
    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        try {
            fs.mkdirSync(this.storeDirectory(), { recursive: true, mode: STORE_MODE });
            fs.chmodSync(this.storeDirectory(), STORE_MODE);
            this.refreshFromDisk();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn('[qaap-job-loop-templates] failed to restore template index:', error);
            }
        }
    }

    list(ownerLogin?: string): QaapJobLoopTemplate[] {
        this.refreshFromDisk();
        const owner = this.normalizeOwner(ownerLogin);
        return [...this.templates.values()]
            .filter(template => template.ownerLogin === owner)
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .map(template => this.clone(template));
    }

    get(ownerLogin: string | undefined, id: string): QaapJobLoopTemplate | undefined {
        this.refreshFromDisk();
        const template = this.templates.get(id);
        return template?.ownerLogin === this.normalizeOwner(ownerLogin) ? this.clone(template) : undefined;
    }

    create(request: QaapCreateJobLoopTemplateRequest, ownerLogin?: string): Promise<QaapJobLoopTemplate> {
        return this.mutate(async templates => {
            const owner = this.normalizeOwner(ownerLogin);
            if (this.ownerTemplates(templates, owner).length >= MAX_TEMPLATES_PER_OWNER) {
                throw new QaapJobLoopTemplateRequestError(nls.localize(
                    'qaap/jobLoopTemplates/limit', 'You can save at most {0} job loop templates.', String(MAX_TEMPLATES_PER_OWNER),
                ));
            }
            const normalized = this.normalizeCreate(request);
            this.assertNameAvailable(templates, owner, normalized.name);
            const now = Date.now();
            const template: QaapJobLoopTemplate = {
                id: randomUUID(), ownerLogin: owner, ...normalized, revision: 1, createdAt: now, updatedAt: now,
            };
            templates.set(template.id, template);
            return template;
        });
    }

    update(id: string, request: QaapUpdateJobLoopTemplateRequest, ownerLogin?: string): Promise<QaapJobLoopTemplate | undefined> {
        return this.mutate(async templates => {
            const owner = this.normalizeOwner(ownerLogin);
            const existing = templates.get(id);
            if (!existing || existing.ownerLogin !== owner) {
                return undefined;
            }
            if (!Number.isSafeInteger(request?.revision) || request.revision !== existing.revision) {
                throw new QaapJobLoopTemplateConflictError(nls.localize(
                    'qaap/jobLoopTemplates/staleRevision', 'This job loop template was changed by another request.',
                ));
            }
            const normalized = this.normalizeUpdate(existing, request);
            this.assertNameAvailable(templates, owner, normalized.name, id);
            const next: QaapJobLoopTemplate = { ...existing, ...normalized, revision: existing.revision + 1, updatedAt: Date.now() };
            templates.set(id, next);
            return next;
        });
    }

    delete(id: string, revision: number, ownerLogin?: string): Promise<boolean | undefined> {
        return this.mutate(async templates => {
            const existing = templates.get(id);
            if (!existing || existing.ownerLogin !== this.normalizeOwner(ownerLogin)) {
                return undefined;
            }
            if (!Number.isSafeInteger(revision) || revision !== existing.revision) {
                throw new QaapJobLoopTemplateConflictError(nls.localize(
                    'qaap/jobLoopTemplates/staleRevision', 'This job loop template was changed by another request.',
                ));
            }
            templates.delete(id);
            return true;
        });
    }

    export(ownerLogin: string | undefined, id: string): QaapJobLoopTemplateExport | undefined {
        const template = this.get(ownerLogin, id);
        return template && {
            format: QAAP_JOB_LOOP_TEMPLATE_EXPORT_FORMAT,
            version: QAAP_JOB_LOOP_TEMPLATE_EXPORT_VERSION,
            template: { name: template.name, description: template.description, definition: template.definition },
        };
    }

    import(request: QaapImportJobLoopTemplateRequest, ownerLogin?: string): Promise<QaapImportJobLoopTemplateResult> {
        const document = request?.document;
        if (!document || document.format !== QAAP_JOB_LOOP_TEMPLATE_EXPORT_FORMAT || document.version !== QAAP_JOB_LOOP_TEMPLATE_EXPORT_VERSION) {
            return Promise.reject(new QaapJobLoopTemplateRequestError(nls.localize(
                'qaap/jobLoopTemplates/invalidImport', 'Invalid job loop template import document.',
            )));
        }
        return this.create(document.template, ownerLogin).then(template => ({ template, created: true }));
    }

    protected async mutate<T>(operation: (templates: Map<string, QaapJobLoopTemplate>) => Promise<T>): Promise<T> {
        const run = this.mutationChain.catch(() => undefined).then(async () => {
            this.refreshFromDisk();
            const proposed = new Map([...this.templates].map(([id, template]) => [id, this.clone(template)]));
            const result = await operation(proposed);
            await this.persist(proposed);
            this.templates.clear();
            for (const [id, template] of proposed) {
                this.templates.set(id, template);
            }
            this.onDidChangeEmitter.fire();
            return this.cloneResult(result);
        });
        this.mutationChain = run.then(() => undefined, () => undefined);
        return run;
    }

    protected normalizeCreate(request: QaapCreateJobLoopTemplateRequest): Pick<QaapJobLoopTemplate, 'name' | 'description' | 'definition'> {
        if (!request || typeof request !== 'object' || Array.isArray(request)) {
            throw new QaapJobLoopTemplateRequestError(nls.localize('qaap/jobLoopTemplates/invalidRequest', 'Invalid job loop template request.'));
        }
        return {
            name: this.normalizeName(request.name),
            description: this.normalizeDescription(request.description),
            definition: this.normalizeDefinition(request.definition),
        };
    }

    protected normalizeUpdate(existing: QaapJobLoopTemplate, request: QaapUpdateJobLoopTemplateRequest): Pick<QaapJobLoopTemplate, 'name' | 'description' | 'definition'> {
        return {
            name: request.name === undefined ? existing.name : this.normalizeName(request.name),
            description: request.description === undefined ? existing.description : this.normalizeDescription(request.description),
            definition: request.definition === undefined ? existing.definition : this.normalizeDefinition(request.definition),
        };
    }

    protected normalizeName(value: unknown): string {
        const name = typeof value === 'string' ? value.trim() : '';
        if (!name || name.length > MAX_NAME_CHARS) {
            throw new QaapJobLoopTemplateRequestError(nls.localize(
                'qaap/jobLoopTemplates/invalidName', 'A template name must contain between 1 and {0} characters.', String(MAX_NAME_CHARS),
            ));
        }
        return name;
    }

    protected normalizeDescription(value: unknown): string | undefined {
        if (value === undefined) {
            return undefined;
        }
        const description = typeof value === 'string' ? value.trim() : undefined;
        if (description === undefined || description.length > MAX_DESCRIPTION_CHARS) {
            throw new QaapJobLoopTemplateRequestError(nls.localize(
                'qaap/jobLoopTemplates/invalidDescription', 'A template description must not exceed {0} characters.', String(MAX_DESCRIPTION_CHARS),
            ));
        }
        return description || undefined;
    }

    protected normalizeDefinition(value: unknown): QaapJobLoopTemplateDefinition {
        if (!value || typeof value !== 'object' || Array.isArray(value) || 'idempotencyKey' in value) {
            throw new QaapJobLoopTemplateRequestError(nls.localize('qaap/jobLoopTemplates/invalidDefinition', 'Invalid job loop template definition.'));
        }
        const definition = this.clone(value) as QaapJobLoopTemplateDefinition;
        const serialized = JSON.stringify(definition);
        if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_DEFINITION_BYTES) {
            throw new QaapJobLoopTemplateRequestError(nls.localize(
                'qaap/jobLoopTemplates/definitionTooLarge', 'A template definition must not exceed 256 KiB.',
            ));
        }
        return definition;
    }

    protected assertNameAvailable(templates: Map<string, QaapJobLoopTemplate>, owner: string | undefined, name: string, exceptId?: string): void {
        const key = name.toLocaleLowerCase();
        if (this.ownerTemplates(templates, owner).some(template => template.id !== exceptId && template.name.toLocaleLowerCase() === key)) {
            throw new QaapJobLoopTemplateConflictError(nls.localize(
                'qaap/jobLoopTemplates/nameExists', 'A job loop template with this name already exists.',
            ));
        }
    }

    protected ownerTemplates(templates: Map<string, QaapJobLoopTemplate>, owner: string | undefined): QaapJobLoopTemplate[] {
        return [...templates.values()].filter(template => template.ownerLogin === owner);
    }

    protected restore(stored: unknown): void {
        const index = stored as Partial<PersistedTemplateIndex>;
        if (index?.version !== 1 || !Array.isArray(index.templates)) {
            throw new Error('Invalid persisted job loop template index.');
        }
        for (const template of index.templates) {
            try {
                const normalized = this.normalizeCreate(template);
                if (typeof template?.id === 'string' && Number.isSafeInteger(template.revision) && template.revision > 0
                    && Number.isSafeInteger(template.createdAt) && Number.isSafeInteger(template.updatedAt)) {
                    this.assertNameAvailable(this.templates, this.normalizeOwner(template.ownerLogin), normalized.name);
                    this.templates.set(template.id, { ...template, ...normalized, ownerLogin: this.normalizeOwner(template.ownerLogin) });
                }
            } catch {
                // Ignore corrupt individual rows while retaining other owners' templates.
            }
        }
    }

    /** Read-through shared state lets a warm replica observe changes made by another backend. */
    protected refreshFromDisk(): void {
        let stored: unknown;
        try {
            stored = JSON.parse(fs.readFileSync(this.indexPath(), 'utf8'));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn('[qaap-job-loop-templates] failed to refresh template index:', error);
            }
            return;
        }
        const previous = new Map(this.templates);
        this.templates.clear();
        try {
            this.restore(stored);
        } catch (error) {
            this.templates.clear();
            for (const [id, template] of previous) { this.templates.set(id, template); }
            console.warn('[qaap-job-loop-templates] ignored invalid shared template index:', error);
        }
    }

    protected async persist(templates: Map<string, QaapJobLoopTemplate>): Promise<void> {
        await fsp.mkdir(this.storeDirectory(), { recursive: true, mode: STORE_MODE });
        await fsp.chmod(this.storeDirectory(), STORE_MODE).catch(() => undefined);
        await writeJsonAtomic(this.indexPath(), { version: 1, templates: [...templates.values()] } satisfies PersistedTemplateIndex, { mode: INDEX_MODE });
    }

    protected storeDirectory(): string {
        return process.env.QAAP_JOB_LOOP_TEMPLATE_STATE_DIR?.trim() || path.join(os.homedir(), '.qaap', 'job-loop-templates');
    }

    protected indexPath(): string { return path.join(this.storeDirectory(), 'index.json'); }
    protected normalizeOwner(ownerLogin?: string): string | undefined { return ownerLogin?.trim() || undefined; }
    protected clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
    protected cloneResult<T>(value: T): T { return value === undefined ? value : this.clone(value); }
}
