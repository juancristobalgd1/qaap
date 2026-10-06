// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    localizeAgentConnectionUnsupportedMessage,
    localizeAgentTenantTerminalLoginMessage,
    QAAP_AI_FEATURES_SETTINGS_QUERY,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-auth-login';
import { localizeHostedLocalhostOAuthAgentMessage } from '@theia/qaap-shared-core/lib/common/qaap-hosted-agent-auth-policy';
import { buildAgentLoginShellCommand } from '@theia/qaap-shared-core/lib/common/qaap-agent-connect-plan';
import { QAAP_AGENT_TASK_API_PATH } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { resolveAgentConnectionFlow } from '@theia/qaap-shared-core/lib/common/qaap-agent-tui-command';
import {
    QAAP_DISABLED_HARNESSES_PREF,
    isQaapHarnessEnabled,
    readDisabledHarnessIds,
    withQaapHarnessEnabled,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-preferences';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { resolveAgentDisplayLabel } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-ui';
import { requestAgentCliUpdate } from '@theia/qaap-agents-ui/lib/common/qaap-agent-cli-update';
import { QaapAgentLoginFlow } from '@theia/qaap-agents-ui/lib/common/qaap-agent-login-flow';
import { createTranscriptTerminalStagingHost, createTranscriptTerminalSurface } from '@theia/qaap-transcript/lib/browser/qaap-transcript-terminal-view';
import { createQaapAgentLoginDialog } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-login-dialog';
import { resolveAgentLoginCwd } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-login-cwd';

const HARNESS_STATUS_TIMEOUT_MS = 5000;
const CONNECTED_CLOSE_DELAY_MS = 1800;

/** The subset of `/harness-status` the Connect flow needs. */
interface AgentLoginHarnessStatus {
    readonly installed?: boolean;
    readonly enabled?: boolean;
    readonly installSupported?: boolean;
    readonly installPackageAvailable?: boolean;
    readonly cliBinDirectory?: string;
}

function stripTerminalControlSequences(value: string): string {
    return value
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
        .replace(/\r/g, '');
}

function wait(milliseconds: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

/** Browser bundles have no Node `process`; Electron frontends do and may run a Windows backend. */
function runtimePlatform(): string | undefined {
    return (globalThis as typeof globalThis & { process?: { readonly platform?: string } }).process?.platform;
}

async function fetchAgentLoginHarnessStatus(agentId: string): Promise<AgentLoginHarnessStatus | undefined> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), HARNESS_STATUS_TIMEOUT_MS);
    try {
        const response = await fetch(`${QAAP_AGENT_TASK_API_PATH}/harness-status`, {
            credentials: 'same-origin',
            signal: controller.signal,
        });
        if (!response.ok) {
            return undefined;
        }
        const payload = await response.json() as { harnesses?: Array<AgentLoginHarnessStatus & { id?: unknown }> };
        const normalizedId = agentId.trim().toLowerCase();
        return payload.harnesses?.find(harness => typeof harness.id === 'string' && harness.id.trim().toLowerCase() === normalizedId);
    } catch {
        // Status is advisory: without it the login still runs and the watchdog reports failures.
        return undefined;
    } finally {
        window.clearTimeout(timeout);
    }
}

function localizeInstallBlockedMessage(agentLabel: string, status: AgentLoginHarnessStatus): string {
    if (status.installPackageAvailable === false) {
        return nls.localize(
            'qaap/mobileProjects/agentLoginDialogNoPackage',
            '{0} is not installed and has no installable package on this server. Ask your administrator to add it to the Qaap image.',
            agentLabel,
        );
    }
    return nls.localize(
        'qaap/mobileProjects/agentLoginDialogInstallDisabled',
        '{0} is not installed and this server does not allow installing harnesses. Ask your administrator to install it.',
        agentLabel,
    );
}

/**
 * Connect dialog for one harness, shared by the IDE and the Work Hub. It installs/enables the
 * harness when needed, runs the real CLI login in a hidden terminal, shows the link / code /
 * paste-code field, and never waits forever: a watchdog turns silence or an exit into the CLI's
 * last output plus Retry.
 */
export async function openAgentLoginDialogInBackground(
    ctx: any,
    project: MobileProjectEntry | undefined,
    summary: QaapAgentConversationSummaryDTO | undefined,
    agentId: string,
    onConnected?: () => boolean | void | Promise<boolean | void>,
): Promise<void> {
    const agentLabel = resolveAgentDisplayLabel(agentId);
    const connectionFlow = resolveAgentConnectionFlow(agentId);

    let staging: HTMLElement | undefined;
    let surface: any;
    let outputListener: { dispose(): void } | undefined;
    let watchdogHandle: number | undefined;
    let connectionPollHandle: number | undefined;
    let successCloseHandle: number | undefined;
    let connectionPollInFlight = false;
    let closed = false;
    let attempt = 0;

    const stopPolling = (): void => {
        if (connectionPollHandle !== undefined) {
            window.clearInterval(connectionPollHandle);
            connectionPollHandle = undefined;
        }
        window.removeEventListener('focus', refreshConnectionState);
        window.removeEventListener('pageshow', refreshConnectionState);
    };

    const disposeTerminal = (): void => {
        stopPolling();
        outputListener?.dispose();
        outputListener = undefined;
        if (surface) {
            try {
                surface.dispose.dispose();
            } catch {
                // The PTY may already have closed while the dialog was being dismissed.
            }
            surface = undefined;
        }
        staging?.remove();
        staging = undefined;
    };

    const close = (): void => {
        if (closed) {
            return;
        }
        closed = true;
        if (watchdogHandle !== undefined) {
            window.clearInterval(watchdogHandle);
            watchdogHandle = undefined;
        }
        if (successCloseHandle !== undefined) {
            window.clearTimeout(successCloseHandle);
            successCloseHandle = undefined;
        }
        disposeTerminal();
        dialog.dispose();
    };

    const flow = new QaapAgentLoginFlow({
        agentId,
        onDidChange: state => {
            if (closed) {
                return;
            }
            dialog.render(state);
            if (state.phase === 'connected') {
                disposeTerminal();
                void Promise.resolve(onConnected?.()).catch(error => {
                    console.warn('[qaap] Agent login UI refresh failed:', error);
                });
                successCloseHandle ??= window.setTimeout(close, CONNECTED_CLOSE_DELAY_MS);
            } else if (state.phase === 'failed') {
                disposeTerminal();
            }
        },
    });

    async function refreshConnectionState(): Promise<void> {
        if (closed || connectionPollInFlight || !onConnected || flow.isSettled) {
            return;
        }
        connectionPollInFlight = true;
        const pollAttempt = attempt;
        try {
            // A poll that resolves after this attempt failed (or a Retry started) must not turn
            // that state into "connected".
            if (await onConnected() === true && !closed && pollAttempt === attempt && !flow.isSettled) {
                flow.connected();
            }
        } catch (error) {
            console.warn('[qaap] Agent login connection refresh failed:', error);
        } finally {
            connectionPollInFlight = false;
        }
    }

    /** Connect is an explicit request to use this harness: a disabled one is enabled first. */
    const enableHarness = async (): Promise<void> => {
        const preferences = ctx.preferenceService;
        if (!preferences) {
            return;
        }
        const disabledIds = readDisabledHarnessIds(preferences.get(QAAP_DISABLED_HARNESSES_PREF));
        if (isQaapHarnessEnabled(agentId, disabledIds)) {
            return;
        }
        await preferences.set(QAAP_DISABLED_HARNESSES_PREF, withQaapHarnessEnabled(disabledIds, agentId, true), PreferenceScope.User);
    };

    const runLogin = async (command: string, status: AgentLoginHarnessStatus | undefined): Promise<void> => {
        const currentAttempt = ++attempt;
        disposeTerminal();
        try {
            if (!project) {
                flow.unavailable(nls.localize(
                    'qaap/mobileProjects/agentLoginDialogNoProject',
                    'Open a project first: {0} signs in from a terminal in that workspace.',
                    agentLabel,
                ));
                return;
            }
            await enableHarness().catch(error => console.warn('[qaap] Could not enable harness before login:', error));
            const loginSummary = summary ?? {
                id: `qaap-agent-login:${project.id}:${agentId}`,
                source: 'qaap-agent',
                cwd: ctx.projectsService?.getProjectCwd?.(project) ?? ctx.preparedCwdByProjectId?.get?.(project.id) ?? '',
                agentId,
                title: nls.localize('qaap/agentLogin/connectTitle', 'Connect {0}', agentLabel),
                status: 'idle',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                messageCount: 0,
            } satisfies QaapAgentConversationSummaryDTO;
            const cwd = await resolveAgentLoginCwd(ctx, project, loginSummary);
            const services = ctx.createTranscriptTerminalViewServices?.();
            if (!cwd || !services) {
                throw new Error(!cwd
                    ? nls.localize('qaap/mobileProjects/agentLoginDialogNoCwd', 'The project folder is not ready in this workspace yet.')
                    : nls.localize('qaap/mobileProjects/agentLoginDialogNoTerminals', 'Terminals are not available in this view.'));
            }
            // Each attempt owns its staging host and terminal until it is still current: a terminal
            // that resolves after its attempt was abandoned (prepare watchdog, Retry) must only
            // dispose itself, never the staging host of the attempt that replaced it (that made the
            // Retry's terminal throw "Host is not attached").
            const attemptStaging = createTranscriptTerminalStagingHost();
            let attemptSurface: any;
            try {
                attemptSurface = await createTranscriptTerminalSurface(attemptStaging, cwd, services);
            } catch (error) {
                attemptStaging.remove();
                throw error;
            }
            // The preparing watchdog may already have given up on this attempt.
            if (closed || currentAttempt !== attempt || !attemptSurface || attemptSurface.terminal.isDisposed || flow.state.phase !== 'preparing') {
                try {
                    attemptSurface?.dispose.dispose();
                } catch {
                    // The PTY may already have closed.
                }
                attemptStaging.remove();
                return;
            }
            staging = attemptStaging;
            surface = attemptSurface;
            outputListener = surface.terminal.onOutput((chunk: string) => {
                flow.appendOutput(stripTerminalControlSequences(chunk));
            });
            await wait(120);
            if (closed || currentAttempt !== attempt || surface.terminal.isDisposed || flow.state.phase !== 'preparing') {
                return;
            }
            flow.commandStarted(Date.now());
            surface.terminal.sendText(`${buildAgentLoginShellCommand(command, {
                cliBinDirectory: status?.cliBinDirectory,
                platform: runtimePlatform(),
            })}\r`);
            if (onConnected) {
                // The browser can return from authorization before the CLI prints its final line.
                void refreshConnectionState();
                connectionPollHandle = window.setInterval(() => void refreshConnectionState(), 2500);
                window.addEventListener('focus', refreshConnectionState);
                window.addEventListener('pageshow', refreshConnectionState);
            }
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            console.warn('[qaap] Agent login terminal unavailable:', detail);
            if (!closed && currentAttempt === attempt && flow.state.phase === 'preparing') {
                flow.terminalUnavailable(detail);
            }
        }
    };

    const startCliLogin = async (command: string): Promise<void> => {
        flow.restart(Date.now());
        const status = await fetchAgentLoginHarnessStatus(agentId);
        if (closed || flow.state.phase !== 'preparing') {
            return;
        }
        if (status && status.installed === false) {
            const canInstall = status.installSupported === true && status.installPackageAvailable !== false;
            flow.requireInstall(canInstall, canInstall ? undefined : localizeInstallBlockedMessage(agentLabel, status));
            return;
        }
        await runLogin(command, status);
    };

    /** BYOK harnesses still need their CLI: an uninstalled one offers Install instead of the key. */
    const startSettingsApiKey = async (): Promise<void> => {
        flow.requireSettingsApiKey();
        void enableHarness().catch(error => console.warn('[qaap] Could not enable harness before login:', error));
        const status = await fetchAgentLoginHarnessStatus(agentId);
        if (closed || flow.state.phase !== 'settings-api-key' || status?.installed !== false) {
            return;
        }
        const canInstall = status.installSupported === true && status.installPackageAvailable !== false;
        flow.requireInstall(canInstall, canInstall ? undefined : localizeInstallBlockedMessage(agentLabel, status));
    };

    const install = async (): Promise<void> => {
        if (connectionFlow.kind !== 'cli-login' && connectionFlow.kind !== 'settings-api-key') {
            return;
        }
        flow.startInstall(Date.now());
        try {
            const result = await requestAgentCliUpdate(agentId);
            // The install watchdog may already have reported a stuck request.
            if (closed || flow.state.phase !== 'installing') {
                return;
            }
            if (!result.ok) {
                flow.installFailed(result.message?.trim() || undefined);
                return;
            }
        } catch (error) {
            if (!closed && flow.state.phase === 'installing') {
                flow.installFailed(error instanceof Error ? error.message : undefined);
            }
            return;
        }
        if (connectionFlow.kind === 'cli-login') {
            await startCliLogin(connectionFlow.command);
        } else {
            flow.requireSettingsApiKey();
        }
    };

    const dialog = createQaapAgentLoginDialog({
        agentId,
        agentLabel,
        onClose: close,
        onSubmitCode: code => {
            if (!surface || surface.terminal.isDisposed) {
                return;
            }
            surface.terminal.sendText(`${code}\r`);
            flow.codeSubmitted(Date.now());
        },
        onRetry: () => {
            if (connectionFlow.kind === 'cli-login') {
                void startCliLogin(connectionFlow.command);
            }
        },
        onInstall: () => void install(),
        onOpenSettings: () => {
            void ctx.openPreferencesSheet?.(QAAP_AI_FEATURES_SETTINGS_QUERY);
            close();
        },
    });

    // One watchdog for the whole dialog: every spinner phase has a deadline, and the shell itself
    // ending (not just the CLI) also ends a running attempt.
    watchdogHandle = window.setInterval(() => {
        const shellExit = surface?.terminal.exitStatus?.code;
        if (typeof shellExit === 'number') {
            flow.exited(shellExit === 0 ? 1 : shellExit);
        }
        flow.tick(Date.now());
    }, 1000);

    switch (connectionFlow.kind) {
        case 'cli-login':
            await startCliLogin(connectionFlow.command);
            return;
        case 'settings-api-key':
            await startSettingsApiKey();
            return;
        case 'tenant-terminal':
            flow.showManualInstructions(localizeAgentTenantTerminalLoginMessage(agentLabel, connectionFlow.command));
            return;
        case 'hosted-restricted':
            flow.showManualInstructions(localizeHostedLocalhostOAuthAgentMessage(agentId));
            return;
        default:
            flow.showManualInstructions(localizeAgentConnectionUnsupportedMessage(agentLabel));
    }
}
