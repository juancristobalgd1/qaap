// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapCreateJobLoopRequest } from './qaap-job-loop';

/** HTTP base path for private reusable job-loop definitions. */
export const QAAP_JOB_LOOP_TEMPLATE_API_PATH = '/qaap/api/job-loop-templates';
export const QAAP_JOB_LOOP_TEMPLATE_EXPORT_FORMAT = 'qaap.job-loop-template';
export const QAAP_JOB_LOOP_TEMPLATE_EXPORT_VERSION = 1;

/** A reusable definition deliberately excludes execution idempotency. */
export type QaapJobLoopTemplateDefinition = Omit<QaapCreateJobLoopRequest, 'idempotencyKey'>;

/** Owner-scoped durable template. Owner and lifecycle metadata are never exported. */
export interface QaapJobLoopTemplate {
    readonly id: string;
    readonly ownerLogin?: string;
    readonly name: string;
    readonly description?: string;
    readonly definition: QaapJobLoopTemplateDefinition;
    readonly revision: number;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface QaapCreateJobLoopTemplateRequest {
    readonly name: string;
    readonly description?: string;
    readonly definition: QaapJobLoopTemplateDefinition;
}

/** `revision` is required so competing edits cannot silently overwrite each other. */
export interface QaapUpdateJobLoopTemplateRequest {
    readonly revision: number;
    readonly name?: string;
    readonly description?: string;
    readonly definition?: QaapJobLoopTemplateDefinition;
}

export interface QaapDeleteJobLoopTemplateRequest {
    readonly revision: number;
}

export interface QaapJobLoopTemplateListResponse {
    readonly templates: readonly QaapJobLoopTemplate[];
}

/** Portable, safe representation: intentionally no id, owner, revision or timestamps. */
export interface QaapJobLoopTemplateExport {
    readonly format: typeof QAAP_JOB_LOOP_TEMPLATE_EXPORT_FORMAT;
    readonly version: typeof QAAP_JOB_LOOP_TEMPLATE_EXPORT_VERSION;
    readonly template: {
        readonly name: string;
        readonly description?: string;
        readonly definition: QaapJobLoopTemplateDefinition;
    };
}

export interface QaapImportJobLoopTemplateRequest {
    readonly document: QaapJobLoopTemplateExport;
}

export interface QaapImportJobLoopTemplateResult {
    readonly template: QaapJobLoopTemplate;
    readonly created: boolean;
}

export interface QaapRunJobLoopTemplateRequest {
    readonly idempotencyKey?: string;
}
