// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { qaapAuthenticatedFetchInit } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { nls } from '@theia/core/lib/common/nls';
import { QaapCreateJobLoopResult } from '../common/qaap-job-loop';
import {
    QAAP_JOB_LOOP_TEMPLATE_API_PATH,
    QaapCreateJobLoopTemplateRequest,
    QaapImportJobLoopTemplateRequest,
    QaapImportJobLoopTemplateResult,
    QaapJobLoopTemplate,
    QaapJobLoopTemplateExport,
    QaapRunJobLoopTemplateRequest,
    QaapUpdateJobLoopTemplateRequest,
} from '../common/qaap-job-loop-template';
import {
    QAAP_JOB_LOOP_TRIGGER_API_PATH,
    QaapCreateJobLoopTriggerBody,
    QaapCreateJobLoopTriggerResponse,
    QaapJobLoopTrigger,
    QaapUpdateJobLoopTriggerBody,
} from '../common/qaap-job-loop-trigger';

interface QaapJobLoopTriggerListResponse {
    readonly triggers: readonly QaapJobLoopTrigger[];
}

/** Error returned by a template or trigger management endpoint. */
export class QaapJobLoopManagementError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'QaapJobLoopManagementError';
    }
}

export async function fetchQaapJobLoopTemplates(): Promise<QaapJobLoopTemplate[]> {
    const body = await requestJson<Partial<{ templates: readonly QaapJobLoopTemplate[] }>>(
        QAAP_JOB_LOOP_TEMPLATE_API_PATH,
    );
    return Array.isArray(body.templates) ? [...body.templates] : [];
}

export function createQaapJobLoopTemplate(request: QaapCreateJobLoopTemplateRequest): Promise<QaapJobLoopTemplate> {
    return requestJson(QAAP_JOB_LOOP_TEMPLATE_API_PATH, jsonRequest('POST', request));
}

export function updateQaapJobLoopTemplate(
    templateId: string,
    request: QaapUpdateJobLoopTemplateRequest,
): Promise<QaapJobLoopTemplate> {
    return requestJson(templatePath(templateId), jsonRequest('PATCH', request));
}

export async function deleteQaapJobLoopTemplate(templateId: string, revision: number): Promise<void> {
    await requestNoContent(templatePath(templateId), jsonRequest('DELETE', { revision }));
}

export function exportQaapJobLoopTemplate(templateId: string): Promise<QaapJobLoopTemplateExport> {
    return requestJson(`${templatePath(templateId)}/export`);
}

export function importQaapJobLoopTemplate(request: QaapImportJobLoopTemplateRequest): Promise<QaapImportJobLoopTemplateResult> {
    return requestJson(`${QAAP_JOB_LOOP_TEMPLATE_API_PATH}/import`, jsonRequest('POST', request));
}

/** Sends the body and header idempotency keys together, as required by the endpoint. */
export function runQaapJobLoopTemplate(
    templateId: string,
    request: QaapRunJobLoopTemplateRequest = {},
): Promise<QaapCreateJobLoopResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (request.idempotencyKey !== undefined) {
        headers['Idempotency-Key'] = request.idempotencyKey;
    }
    return requestJson(`${templatePath(templateId)}/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
    });
}

export async function fetchQaapJobLoopTriggers(): Promise<QaapJobLoopTrigger[]> {
    const body = await requestJson<Partial<QaapJobLoopTriggerListResponse>>(QAAP_JOB_LOOP_TRIGGER_API_PATH);
    return Array.isArray(body.triggers) ? [...body.triggers] : [];
}

/** A webhook secret, when returned, is intentionally available only from this creation response. */
export function createQaapJobLoopTrigger(
    request: QaapCreateJobLoopTriggerBody,
): Promise<QaapCreateJobLoopTriggerResponse> {
    return requestJson(QAAP_JOB_LOOP_TRIGGER_API_PATH, jsonRequest('POST', request));
}

export function updateQaapJobLoopTrigger(
    triggerId: string,
    request: QaapUpdateJobLoopTriggerBody,
): Promise<QaapJobLoopTrigger> {
    return requestJson(triggerPath(triggerId), jsonRequest('PATCH', request));
}

export async function deleteQaapJobLoopTrigger(triggerId: string): Promise<void> {
    await requestNoContent(triggerPath(triggerId), { method: 'DELETE' });
}

export function fireQaapJobLoopTrigger(triggerId: string): Promise<QaapJobLoopTrigger> {
    return requestJson(`${triggerPath(triggerId)}/fire`, { method: 'POST' });
}

function templatePath(templateId: string): string {
    return `${QAAP_JOB_LOOP_TEMPLATE_API_PATH}/${encodeURIComponent(templateId)}`;
}

function triggerPath(triggerId: string): string {
    return `${QAAP_JOB_LOOP_TRIGGER_API_PATH}/${encodeURIComponent(triggerId)}`;
}

function jsonRequest(method: 'POST' | 'PATCH' | 'DELETE', body: unknown): RequestInit {
    return {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, qaapAuthenticatedFetchInit(init));
    if (!response.ok) {
        throw await managementError(response);
    }
    return response.json() as Promise<T>;
}

async function requestNoContent(url: string, init?: RequestInit): Promise<void> {
    const response = await fetch(url, qaapAuthenticatedFetchInit(init));
    if (!response.ok) {
        throw await managementError(response);
    }
}

async function managementError(response: Response): Promise<QaapJobLoopManagementError> {
    const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
    const message = typeof body?.error === 'string' && body.error.trim()
        ? body.error
        : nls.localize(
            'qaap/jobLoops/managementRequestFailed',
            'Job loop management request failed ({0}).',
            String(response.status),
        );
    return new QaapJobLoopManagementError(response.status, message);
}
