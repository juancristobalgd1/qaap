// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { context, SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { createLogger, format, transports, type Logger as WinstonLogger } from 'winston';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import type { QaapAgentTask, QaapAgentTaskState } from '../common/qaap-agent-task';

const QAAP_AUDIT_SCHEMA_VERSION = 1;
const QAAP_AUDIT_SERVICE_NAME = 'qaap-cloud-workspace';
const QAAP_AUDIT_LOG_PATH_ENV = 'QAAP_AUDIT_LOG_PATH';
const QAAP_AUDIT_LOG_LEVEL_ENV = 'QAAP_AUDIT_LOG_LEVEL';
const QAAP_AUDIT_LOG_ENABLED_ENV = 'QAAP_AUDIT_LOG_ENABLED';
const QAAP_AUDIT_MAX_COMMAND_LENGTH = 4_096;
const QAAP_AUDIT_MAX_AGENT_PREVIEW_LENGTH = 320;

export type QaapAuditLevel = 'info' | 'warn' | 'error';

export type QaapAuditValue = string | number | boolean | undefined;

export interface QaapAuditFields {
    readonly [key: string]: QaapAuditValue;
}

export type QaapAgentCommandExecutionKind = 'agent-cli' | 'agent-tool' | 'verification' | 'shell';

export interface QaapQuotaConsumptionAudit {
    readonly tenantLogin: string;
    readonly resource: 'hosted-credits' | 'runtime-minutes';
    readonly outcome: 'charged' | 'denied' | 'fair-use';
    readonly planId: string;
    readonly modelId?: string;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly requestedCredits?: number;
    readonly chargedCredits?: number;
    readonly creditsBefore?: number;
    readonly creditsAfter?: number;
    readonly remainingCredits?: number;
    readonly requestedMinutes?: number;
    readonly chargedMinutes?: number;
    readonly runtimeBefore?: number;
    readonly runtimeAfter?: number;
    readonly remainingRuntimeMinutes?: number;
    readonly durationMs?: number;
    readonly reason?: string;
}

export interface QaapAgentToolCommandAudit {
    readonly taskId: string;
    readonly tenantLogin?: string;
    readonly agentId?: string;
    readonly requestId?: string;
    readonly toolUseId?: string;
    readonly toolName?: string;
    readonly command?: string;
    readonly decision: 'approve' | 'reject' | 'queue';
}

/**
 * Redacts common credential-shaped command arguments before they reach an audit sink.
 * The audit record keeps a SHA-256 hash as a stable forensic correlation key.
 */
export function redactQaapCommand(command: string, maxLength = QAAP_AUDIT_MAX_COMMAND_LENGTH): string {
    let redacted = command.replace(/(\bauthorization\b\s*[:=]\s*Bearer\s+)[^\s'"`]+/gi, '$1[REDACTED]');
    redacted = redacted.replace(/(\b(?:authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret)\b\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s]+)/gi, '$1[REDACTED]');
    redacted = redacted.replace(/(\bBearer\s+)[^\s'"`]+/gi, '$1[REDACTED]');
    redacted = redacted.replace(/(--(?:token|password|secret|api[-_]key)(?:=|\s+))[^\s]+/gi, '$1[REDACTED]');
    redacted = redacted.replace(/\s+/g, ' ').trim();
    return redacted.length <= maxLength
        ? redacted
        : `${redacted.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function qaapCommandHash(command: string): string {
    return createHash('sha256').update(command, 'utf8').digest('hex');
}

export function summarizeQaapAgentCommand(command: string): string {
    const prefix = command.replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
    return redactQaapCommand(prefix, QAAP_AUDIT_MAX_AGENT_PREVIEW_LENGTH);
}

export function buildQaapAuditFields(fields: QaapAuditFields): QaapAuditFields {
    return Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
    );
}

/**
 * Structured audit logger for tenant activity. Winston's JSON formatter produces one JSON object
 * per line. When an OpenTelemetry SDK is installed by the host, active span identifiers are added
 * to the same record and spans created by {@link withSpan} are exported by that SDK.
 */
@injectable()
export class QaapObservability {

    protected readonly logger: WinstonLogger;
    protected readonly tracer = trace.getTracer(QAAP_AUDIT_SERVICE_NAME);
    protected readonly enabled: boolean;
    protected readonly commandSpans = new Map<string, Span>();

    constructor() {
        this.enabled = process.env[QAAP_AUDIT_LOG_ENABLED_ENV]?.trim().toLowerCase() !== 'false';
        this.logger = createLogger({
            level: process.env[QAAP_AUDIT_LOG_LEVEL_ENV]?.trim() || 'info',
            format: format.combine(
                format.timestamp(),
                format.errors({ stack: true }),
                format.json(),
            ),
            transports: this.createTransports(),
        });
    }

    record(event: string, fields: QaapAuditFields = {}, level: QaapAuditLevel = 'info'): void {
        if (!this.enabled) {
            return;
        }
        const spanContext = trace.getActiveSpan()?.spanContext();
        const record = buildQaapAuditFields({
            schemaVersion: QAAP_AUDIT_SCHEMA_VERSION,
            service: QAAP_AUDIT_SERVICE_NAME,
            event,
            eventId: randomUUID(),
            ...fields,
            ...(spanContext?.traceId && spanContext.traceId !== '00000000000000000000000000000000'
                ? { traceId: spanContext.traceId }
                : {}),
            ...(spanContext?.spanId && spanContext.spanId !== '0000000000000000'
                ? { spanId: spanContext.spanId }
                : {}),
        });
        this.logger.log({ level, message: event, ...record });
    }

    async withSpan<T>(
        name: string,
        attributes: QaapAuditFields,
        callback: () => Promise<T>,
    ): Promise<T> {
        if (!this.enabled) {
            return callback();
        }
        const spanAttributes = Object.fromEntries(
            Object.entries(attributes).filter(([, value]) => value !== undefined),
        ) as Attributes;
        return this.tracer.startActiveSpan(name, { attributes: spanAttributes }, async span => {
            try {
                const result = await context.with(trace.setSpan(context.active(), span), callback);
                span.setStatus({ code: SpanStatusCode.OK });
                return result;
            } catch (error) {
                span.recordException(error instanceof Error ? error : new Error(String(error)));
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error instanceof Error ? error.message : String(error),
                });
                throw error;
            } finally {
                span.end();
            }
        });
    }

    recordSessionStarted(conversation: Pick<QaapAgentConversation, 'id' | 'cwd' | 'agentId' | 'ownerLogin'>): void {
        this.recordWithInstantSpan('qaap.session.started', 'session.started', {
            sessionId: conversation.id,
            tenantLogin: conversation.ownerLogin,
            agentId: conversation.agentId,
            cwd: conversation.cwd,
        });
    }

    recordAgentCommandStarted(
        task: Pick<QaapAgentTask, 'id' | 'command' | 'cwd' | 'agentId' | 'ownerLogin'>,
        executionKind: QaapAgentCommandExecutionKind,
    ): void {
        const command = task.command.trim();
        const fields = {
            taskId: task.id,
            tenantLogin: task.ownerLogin,
            agentId: task.agentId,
            cwd: task.cwd,
            executionKind,
            commandHash: qaapCommandHash(command),
            ...(executionKind === 'agent-cli' && task.agentId !== 'shell'
                ? { commandPreview: summarizeQaapAgentCommand(command) }
                : { command: redactQaapCommand(command) }),
        } satisfies QaapAuditFields;
        if (!this.enabled) {
            return;
        }
        const span = this.tracer.startSpan(`qaap.agent.command.${executionKind}`, {
            attributes: this.toSpanAttributes({
                taskId: task.id,
                tenantLogin: task.ownerLogin,
                agentId: task.agentId,
                executionKind,
                commandHash: qaapCommandHash(command),
            }),
        });
        const spanKey = this.commandSpanKey(task.id, executionKind);
        this.commandSpans.get(spanKey)?.end();
        this.commandSpans.set(spanKey, span);
        context.with(trace.setSpan(context.active(), span), () => this.record('agent.command.started', fields));
    }

    recordAgentCommandFinished(
        task: Pick<QaapAgentTask, 'id' | 'command' | 'agentId' | 'ownerLogin'>,
        state: QaapAgentTaskState,
        exitCode: number | undefined,
        durationMs: number | undefined,
        executionKind: QaapAgentCommandExecutionKind = 'agent-cli',
    ): void {
        const command = task.command.trim();
        const fields = {
            taskId: task.id,
            tenantLogin: task.ownerLogin,
            agentId: task.agentId,
            executionKind,
            commandHash: qaapCommandHash(command),
            state,
            exitCode,
            durationMs,
        } satisfies QaapAuditFields;
        const span = this.commandSpans.get(this.commandSpanKey(task.id, executionKind));
        if (span) {
            span.setAttributes(this.toSpanAttributes({ state, exitCode, durationMs }));
            context.with(trace.setSpan(context.active(), span), () => this.record('agent.command.finished', fields));
            span.setStatus({ code: state === 'completed' ? SpanStatusCode.OK : SpanStatusCode.ERROR });
            span.end();
            this.commandSpans.delete(this.commandSpanKey(task.id, executionKind));
            return;
        }
        this.record('agent.command.finished', fields);
    }

    recordAgentToolCommand(commandAudit: QaapAgentToolCommandAudit): void {
        const command = commandAudit.command?.trim();
        this.recordWithInstantSpan('qaap.agent.tool.command', 'agent.tool.command', {
            taskId: commandAudit.taskId,
            tenantLogin: commandAudit.tenantLogin,
            agentId: commandAudit.agentId,
            requestId: commandAudit.requestId,
            toolUseId: commandAudit.toolUseId,
            toolName: commandAudit.toolName,
            decision: commandAudit.decision,
            ...(command
                ? {
                    command: redactQaapCommand(command),
                    commandHash: qaapCommandHash(command),
                }
                : {}),
        });
    }

    recordQuotaConsumption(audit: QaapQuotaConsumptionAudit): void {
        this.record('quota.consumption', buildQaapAuditFields({
            tenantLogin: audit.tenantLogin,
            resource: audit.resource,
            outcome: audit.outcome,
            planId: audit.planId,
            modelId: audit.modelId,
            inputTokens: audit.inputTokens,
            outputTokens: audit.outputTokens,
            requestedCredits: audit.requestedCredits,
            chargedCredits: audit.chargedCredits,
            creditsBefore: audit.creditsBefore,
            creditsAfter: audit.creditsAfter,
            remainingCredits: audit.remainingCredits,
            requestedMinutes: audit.requestedMinutes,
            chargedMinutes: audit.chargedMinutes,
            runtimeBefore: audit.runtimeBefore,
            runtimeAfter: audit.runtimeAfter,
            remainingRuntimeMinutes: audit.remainingRuntimeMinutes,
            durationMs: audit.durationMs,
            reason: audit.reason,
        }));
    }

    protected createTransports(): Array<transports.ConsoleTransportInstance | transports.FileTransportInstance> {
        if (!this.enabled) {
            return [];
        }
        const result: Array<transports.ConsoleTransportInstance | transports.FileTransportInstance> = [
            new transports.Console(),
        ];
        const auditPath = process.env[QAAP_AUDIT_LOG_PATH_ENV]?.trim();
        if (auditPath) {
            try {
                fs.mkdirSync(path.dirname(path.resolve(auditPath)), { recursive: true });
                result.push(new transports.File({ filename: auditPath }));
            } catch {
                // Console JSON remains available if the optional file sink cannot be prepared.
            }
        }
        return result;
    }

    protected recordWithInstantSpan(name: string, event: string, fields: QaapAuditFields): void {
        if (!this.enabled) {
            return;
        }
        const span = this.tracer.startSpan(name, { attributes: this.toSpanAttributes(fields) });
        try {
            context.with(trace.setSpan(context.active(), span), () => this.record(event, fields));
            span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
            span.recordException(error instanceof Error ? error : new Error(String(error)));
            span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
        } finally {
            span.end();
        }
    }

    protected toSpanAttributes(fields: QaapAuditFields): Attributes {
        return Object.fromEntries(
            Object.entries(fields).filter(([, value]) => value !== undefined),
        ) as Attributes;
    }

    protected commandSpanKey(taskId: string, executionKind: QaapAgentCommandExecutionKind): string {
        return `${executionKind}:${taskId}`;
    }
}
