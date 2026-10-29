// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { findQaiqDestructiveCommandGuardDenial } from '../common/qaap-agent-destructive-command-guard';
import { findQaiqDevServerGuardDenial } from '../common/qaap-agent-dev-server-guard';
import {
    buildQaiqAutoDeniedToolMessage,
    resolveQaiqControlRequestAutoAction,
    resolveQaiqControlRequestAutoDecision,
    type QaapQaiqControlAutoAction,
    type QaapQaiqControlAutoOptions,
    type QaapQaiqControlAutoReason,
} from '../common/qaap-qaiq-control-auto-response';
import type { QaapQaiqPendingControlRequest } from '../common/qaap-qaiq-stdio-approvals';

/** Everything the service needs to decide one QAIQ `can_use_tool` control request. */
export interface QaapQaiqToolGateInput {
    /** Spawned CLI command line; the approval flags in it are the policy signal. */
    readonly command: string;
    /** Task `autoApprove`: `false` is request-approval, anything else auto-approves what the guards allow. */
    readonly autoApprove: boolean | undefined;
    readonly request: QaapQaiqPendingControlRequest;
    readonly cwd: string;
    /** Read-only shell preference and the runtime safety checks the classifier needs. */
    readonly options: QaapQaiqControlAutoOptions;
    /** Lazy: only consulted when the request is answered without queueing, like the legacy inline code. */
    readonly reservedPort?: () => number | undefined;
}

export interface QaapQaiqToolGateOutcome {
    readonly action: QaapQaiqControlAutoAction;
    readonly reason?: QaapQaiqControlAutoReason;
    readonly detail?: string;
    /** Set when a read-only shell command was NOT auto-approved because of a runtime safety check. */
    readonly readOnlyBlockedReason?: string;
    readonly devServerDenial?: string;
    readonly destructiveDenial?: string;
    /** The reserved dev-preview port the dev-server denial was built with (resolved once per request). */
    readonly reservedPort?: number;
    /** Deny guidance for the agent; set only when {@link action} is not `queue`. */
    readonly denyMessage?: string;
    /** The `decision` the observability record carries for this answer. */
    readonly observabilityDecision: 'approve' | 'reject' | 'queue';
    /** True when a queued request must get the unattended-run grace timeout (auto-approve runs only). */
    readonly scheduleQueueTimeout: boolean;
}

/**
 * The single place that decides whether a tool call runs. P0-1: the QAIQ stdio decision logic moved
 * here from the task runner, byte-for-byte; the runner keeps only the side effects (stdin response,
 * approval queue, observability, logging). Stateless and synchronous on purpose, so the golden
 * corpus (`qaap-tool-gate-service.spec.ts`) can lock it.
 */
@injectable()
export class QaapToolGateService {

    /**
     * Precedence: dev-server deny > destructive guard > core `--tools` allowlist deny > read-only shell
     * auto-approval > preset rules (see {@link resolveQaiqControlRequestAutoDecision}); then, for any
     * answer other than queue, the dev-server / destructive guard messages take priority over the
     * generic headless-tool deny message.
     */
    evaluateQaiqControlRequest(input: QaapQaiqToolGateInput): QaapQaiqToolGateOutcome {
        const { command, autoApprove, request, cwd } = input;
        const autoDecision = resolveQaiqControlRequestAutoDecision(command, autoApprove, request, input.options);
        const action = autoDecision.action;
        let devServerDenial: string | undefined;
        let destructiveDenial: string | undefined;
        let denyMessage: string | undefined;
        let reservedPort: number | undefined;
        if (action !== 'queue') {
            reservedPort = input.reservedPort?.();
            devServerDenial = findQaiqDevServerGuardDenial(request, { reservedPort });
            destructiveDenial = findQaiqDestructiveCommandGuardDenial(request, cwd);
            denyMessage = devServerDenial
                ?? destructiveDenial
                ?? (action === 'deny' && request.toolName
                    ? buildQaiqAutoDeniedToolMessage(request.toolName, request.toolInput)
                    : undefined);
        }
        return {
            action,
            ...(autoDecision.reason !== undefined ? { reason: autoDecision.reason } : {}),
            ...(autoDecision.detail !== undefined ? { detail: autoDecision.detail } : {}),
            ...(autoDecision.readOnlyBlockedReason !== undefined ? { readOnlyBlockedReason: autoDecision.readOnlyBlockedReason } : {}),
            ...(devServerDenial !== undefined ? { devServerDenial } : {}),
            ...(destructiveDenial !== undefined ? { destructiveDenial } : {}),
            ...(reservedPort !== undefined ? { reservedPort } : {}),
            ...(denyMessage !== undefined ? { denyMessage } : {}),
            observabilityDecision: action === 'allow' ? 'approve' : action === 'deny' ? 'reject' : 'queue',
            scheduleQueueTimeout: action === 'queue' && autoApprove !== false,
        };
    }

    /**
     * A PreToolUse hook may approve, but never past a Qaap deny rule (core `--tools` allowlist,
     * dev-server guard, destructive-command guard): such requests fall through to the normal path.
     */
    isHookAllowBlocked(command: string | undefined, autoApprove: boolean | undefined,
        request: QaapQaiqPendingControlRequest, cwd: string): boolean {
        return resolveQaiqControlRequestAutoAction(command ?? '', autoApprove, request) === 'deny'
            || !!findQaiqDevServerGuardDenial(request)
            || !!findQaiqDestructiveCommandGuardDenial(request, cwd);
    }
}

/** Stateless fallback for bare test harnesses that build a runner context without DI. */
export const DEFAULT_QAAP_TOOL_GATE_SERVICE = new QaapToolGateService();
