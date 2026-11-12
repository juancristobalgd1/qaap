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
import {
    resolveAgentConnectionFlow,
    type QaapAgentConnectionFlow,
    type QaapAgentLoginInputStep,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-tui-command';
import { QAAP_PI_LOGIN_PROVIDERS } from '@theia/qaap-shared-core/lib/common/qaap-pi-login-providers';
import {
    QAAP_DISABLED_HARNESSES_PREF,
    isQaapHarnessEnabled,
    readDisabledHarnessIds,
    withQaapHarnessEnabled,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-preferences';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { resolveAgentDisplayLabel } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-ui';
import { requestAgentCliUpdate } from '@theia/qaap-agents-ui/lib/common/qaap-agent-cli-update';
import { QaapAgentLoginFlow, stripAgentLoginTerminalControlSequences } from '@theia/qaap-agents-ui/lib/common/qaap-agent-login-flow';
import { QaapAgentLoginInputDriver } from '@theia/qaap-agents-ui/lib/common/qaap-agent-login-input-driver';
import { createTranscriptTerminalStagingHost, createTranscriptTerminalSurface } from '@theia/qaap-transcript/lib/browser/qaap-transcript-terminal-view';
import { createQaapAgentLoginDialog } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-login-dialog';
import { resolveAgentLoginCwd } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-login-cwd';
import { agentLoginUtf8ByteLength, QaapAgentLoginBufferTap } from './qaap-agent-login-buffer-tap';

const HARNESS_STATUS_TIMEOUT_MS = 5000;
const CONNECTED_CLOSE_DELAY_MS = 1800;
/** A driven TUI login starts the CLI first, then types its way to the link. */
const TUI_LOGIN_CHALLENGE_TIMEOUT_MS = 30_000;
const INPUT_DRIVER_TICK_MS = 150;
/** Output the live stream missed is read back from the terminal screen this often. */
const BUFFER_TAP_POLL_MS = 400;

/** The subset of `/harness-status` the Connect flow needs. */
interface AgentLoginHarnessStatus {
    readonly installed?: boolean;
    readonly enabled?: boolean;
    readonly installSupported?: boolean;
    readonly installPackageAvailable?: boolean;
    readonly cliBinDirectory?: string;
    /** The Antigravity CLI the server resolved (`gemini`, `agy`, `antigravity`); decides whether Connect runs a hidden login. */
    readonly cliBin?: string;
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
/** Command run in the hidden terminal, and the keystrokes that drive it (TUI logins). */
interface AgentLoginHiddenCommand {
    readonly command: string;
    readonly input?: readonly QaapAgentLoginInputStep[];
    readonly env?: Readonly<Record<string, string>>;
}

function resolveHiddenLogin(connectionFlow: QaapAgentConnectionFlow): AgentLoginHiddenCommand | undefined {
    return connectionFlow.kind === 'cli-login'
        ? { command: connectionFlow.command }
        : connectionFlow.kind === 'tui-login'
            ? { command: connectionFlow.command, input: connectionFlow.input, env: connectionFlow.env }
            : undefined;
}

export async function openAgentLoginDialogInBackground(
    ctx: any,
    project: MobileProjectEntry | undefined,
    summary: QaapAgentConversationSummaryDTO | undefined,
    agentId: string,
    onConnected?: () => boolean | void | Promise<boolean | void>,
): Promise<void> {
    const agentLabel = resolveAgentDisplayLabel(agentId);
    // Pi's provider can be switched in the dialog: the flow and its keystrokes follow the choice.
    let connectionFlow = resolveAgentConnectionFlow(agentId);
    let hiddenLogin = resolveHiddenLogin(connectionFlow);

    let staging: HTMLElement | undefined;
    let surface: any;
    let outputListener: { dispose(): void } | undefined;
    let watchdogHandle: number | undefined;
    let inputDriver: QaapAgentLoginInputDriver | undefined;
    let inputDriverHandle: number | undefined;
    let bufferTap: QaapAgentLoginBufferTap | undefined;
    let bufferTapHandle: number | undefined;
    /** UTF-8 bytes the live `onOutput` stream delivered in the current attempt (diagnostics only). */
    let onOutputBytes = 0;
    /**
     * Whether a "connected" answer of the status probe proves this sign-in. A TUI login can run
     * while the harness is already connected (Pi: adding another provider), so there the probe
     * only counts once it said "not connected" before the CLI started; the CLI's own
     * `Logged in to …` line is the proof otherwise.
     */
    let probeProvesLogin = true;
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

    const stopInputDriver = (): void => {
        inputDriver?.stop();
        inputDriver = undefined;
        if (inputDriverHandle !== undefined) {
            window.clearInterval(inputDriverHandle);
            inputDriverHandle = undefined;
        }
    };

    /**
     * Closes the hidden sign-in terminal. Disposing the surface closes its PTY on the backend
     * (`closeOnDispose`), which ends the shell and the CLI with it: an interactive CLI such as
     * Pi's TUI (and its 127.0.0.1 callback listener) never outlives the dialog attempt.
     */
    const stopBufferTap = (): void => {
        if (bufferTapHandle !== undefined) {
            window.clearInterval(bufferTapHandle);
            bufferTapHandle = undefined;
        }
        bufferTap?.dispose();
        bufferTap = undefined;
    };

    const disposeTerminal = (): void => {
        stopPolling();
        stopInputDriver();
        stopBufferTap();
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
        window.removeEventListener('beforeunload', closeBeforeUnload);
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

    // Registered before any sign-in terminal exists, so it runs ahead of the surface's own
    // reload hook that would keep the PTY alive for a restore nobody performs for this terminal.
    const closeBeforeUnload = (): void => close();
    window.addEventListener('beforeunload', closeBeforeUnload);

    /** What the host saw from the sign-in terminal: whether xterm opened, and the bytes per channel. */
    const terminalDiagnostics = (): { readonly agentId: string; readonly opened: boolean; readonly onOutputBytes: number; readonly bufferBytes: number } => ({
        agentId,
        opened: (surface?.terminal as { termOpened?: boolean } | undefined)?.termOpened === true,
        onOutputBytes,
        bufferBytes: bufferTap?.fedBytes ?? 0,
    });

    const describeTerminalDiagnostics = (facts: ReturnType<typeof terminalDiagnostics>): string => nls.localize(
        'qaap/agentLogin/diagnosticsDetail',
        'Terminal started: {0}. Output received: {1} bytes from the live stream, {2} bytes from the terminal screen.',
        facts.opened ? nls.localize('qaap/agentLogin/diagnosticsYes', 'yes') : nls.localize('qaap/agentLogin/diagnosticsNo', 'no'),
        String(facts.onOutputBytes),
        String(facts.bufferBytes),
    );

    const flow = new QaapAgentLoginFlow({
        agentId,
        ...(connectionFlow.kind === 'tui-login' ? { challengeTimeoutMs: TUI_LOGIN_CHALLENGE_TIMEOUT_MS } : {}),
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
                if (state.reason === 'timeout' && state.tail.length === 0) {
                    console.warn('[qaap] agent login produced no output', terminalDiagnostics());
                }
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
            if (await onConnected() === true && probeProvesLogin && !closed && pollAttempt === attempt && !flow.isSettled) {
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

    /** Baseline status probe of a TUI login, taken before the CLI can change it. */
    const takeProbeBaseline = (currentAttempt: number): void => {
        probeProvesLogin = false;
        if (!onConnected) {
            return;
        }
        void Promise.resolve(onConnected()).then(connected => {
            if (currentAttempt === attempt) {
                probeProvesLogin = connected !== true;
            }
        }, error => console.warn('[qaap] Agent login baseline status failed:', error));
    };

    /** Reads the screen for output the live stream missed; stops once the attempt is no longer waiting. */
    const pollBufferTap = (): void => {
        const phase = flow.state.phase;
        if (closed || !bufferTap || (phase !== 'waiting' && phase !== 'challenge' && phase !== 'code-submitted')) {
            stopBufferTap();
            return;
        }
        bufferTap.poll();
    };

    const startInputDriver = (steps: readonly QaapAgentLoginInputStep[], currentAttempt: number): void => {
        const driverSurface = surface;
        const driver = new QaapAgentLoginInputDriver({
            steps,
            now: Date.now(),
            send: text => {
                if (driverSurface && !driverSurface.terminal.isDisposed) {
                    driverSurface.terminal.sendText(text);
                }
            },
            onRestart: now => flow.restartWaitingDeadline(now),
        });
        inputDriver = driver;
        inputDriverHandle = window.setInterval(() => {
            // Typing stops once the link shows up (or the attempt ended): the rest is the user's.
            if (closed || currentAttempt !== attempt || flow.state.phase !== 'waiting' || driver.done) {
                if (inputDriver === driver) {
                    stopInputDriver();
                }
                return;
            }
            driver.tick(Date.now());
        }, INPUT_DRIVER_TICK_MS);
    };

    const runLogin = async (
        command: string,
        status: AgentLoginHarnessStatus | undefined,
        input?: readonly QaapAgentLoginInputStep[],
    ): Promise<void> => {
        const currentAttempt = ++attempt;
        disposeTerminal();
        onOutputBytes = 0;
        probeProvesLogin = true;
        if (input?.length) {
            takeProbeBaseline(currentAttempt);
        }
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
            const liveTerminal = surface.terminal;
            outputListener = liveTerminal.onOutput((chunk: string) => {
                onOutputBytes += agentLoginUtf8ByteLength(chunk);
                bufferTap?.noteOutput();
                inputDriver?.feed(stripAgentLoginTerminalControlSequences(chunk), Date.now());
                flow.appendRawOutput(chunk);
            });
            await wait(120);
            if (closed || currentAttempt !== attempt || liveTerminal.isDisposed || flow.state.phase !== 'preparing') {
                return;
            }
            // Baseline the screen read before the command: what is on it now is shell prompt, not login output.
            const tap = new QaapAgentLoginBufferTap({
                buffer: () => (liveTerminal.isDisposed ? undefined : liveTerminal.buffer),
                feed: text => {
                    inputDriver?.feed(text, Date.now());
                    flow.appendRawOutput(text);
                },
                columns: () => (liveTerminal as unknown as { term?: { cols?: number } }).term?.cols,
            });
            tap.noteOutput();
            bufferTap = tap;
            flow.commandStarted(Date.now());
            liveTerminal.sendText(`${buildAgentLoginShellCommand(command, {
                cliBinDirectory: status?.cliBinDirectory,
                platform: runtimePlatform(),
                env: hiddenLogin?.env,
            })}\r`);
            if (input?.length) {
                startInputDriver(input, currentAttempt);
            }
            bufferTapHandle = window.setInterval(pollBufferTap, BUFFER_TAP_POLL_MS);
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

    const startCliLogin = async (command: string, input?: readonly QaapAgentLoginInputStep[]): Promise<void> => {
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
        // The resolved Antigravity CLI decides the sign-in: `agy` has no login command, so no hidden
        // Gemini login runs and the user gets the terminal instructions instead.
        const resolvedFlow = resolveAgentConnectionFlow(agentId, { cliBin: status?.cliBin });
        if (resolvedFlow.kind === 'tenant-terminal') {
            flow.showManualInstructions(localizeAgentTenantTerminalLoginMessage(agentLabel, resolvedFlow.command, resolvedFlow.followUp));
            return;
        }
        await runLogin(command, status, input);
    };

    /** BYOK harnesses still need their CLI: an uninstalled one offers Install instead of the key. */
    const install = async (): Promise<void> => {
        if (!hiddenLogin) {
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
        if (hiddenLogin) {
            await startCliLogin(hiddenLogin.command, hiddenLogin.input);
        } else {
            flow.requireSettingsApiKey();
        }
    };

    /**
     * Tenant-terminal harnesses sign in interactively, so the user gets a visible workspace
     * terminal running the CLI; for a TUI login (Pi) it is the fallback next to the in-dialog
     * sign-in (run `pi`, type `/login`). The dialog closes; the connection state is refreshed by
     * the agent picker's own refresh once they come back.
     */
    const openVisibleTerminal = async (command: string): Promise<void> => {
        if (!project) {
            return;
        }
        const terminalSummary = summary ?? {
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
        close();
        try {
            await ctx.transcriptSurfacesUi.launchAgentTuiInTranscriptTerminal(project, terminalSummary, agentId, { command });
        } catch (error) {
            console.warn('[qaap] Could not open the sign-in terminal:', error);
        }
    };

    /** Pi: picking another account provider cancels the running sign-in and starts `/login <id>` again. */
    const selectLoginProvider = (providerId: string): void => {
        const next = resolveAgentConnectionFlow(agentId, { provider: providerId });
        if (closed || next.kind !== 'tui-login') {
            return;
        }
        connectionFlow = next;
        hiddenLogin = resolveHiddenLogin(next);
        void startCliLogin(next.command, next.input);
    };

    /** Manual route: the visible terminal's command (the Pi fallback is the same for every provider). */
    const terminalCommand: string | undefined = connectionFlow.kind === 'tui-login'
        ? connectionFlow.fallbackCommand
        : connectionFlow.kind === 'tenant-terminal'
            ? connectionFlow.command
            : undefined;

    const dialog = createQaapAgentLoginDialog({
        agentId,
        agentLabel,
        onClose: close,
        ...(connectionFlow.kind === 'tui-login' ? {
            loginProviders: {
                options: QAAP_PI_LOGIN_PROVIDERS.map(provider => ({ id: provider.id, label: provider.name })),
                selectedId: connectionFlow.provider,
                onSelect: selectLoginProvider,
            },
        } : {}),
        onSubmitCode: code => {
            if (!surface || surface.terminal.isDisposed) {
                return;
            }
            surface.terminal.sendText(`${code}\r`);
            flow.codeSubmitted(Date.now());
        },
        onRetry: () => {
            if (hiddenLogin) {
                void startCliLogin(hiddenLogin.command, hiddenLogin.input);
            }
        },
        onInstall: () => void install(),
        onOpenTerminal: terminalCommand !== undefined
            && project && typeof ctx.transcriptSurfacesUi?.launchAgentTuiInTranscriptTerminal === 'function'
            ? () => void openVisibleTerminal(terminalCommand)
            : undefined,
        ...(connectionFlow.kind === 'tui-login' ? {
            openTerminalHint: localizeAgentTenantTerminalLoginMessage(agentLabel, connectionFlow.fallbackCommand, connectionFlow.followUp),
        } : {}),
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
        flow.setDiagnostics(describeTerminalDiagnostics(terminalDiagnostics()));
        flow.tick(Date.now());
    }, 1000);

    switch (connectionFlow.kind) {
        case 'cli-login':
        case 'tui-login':
            await startCliLogin(hiddenLogin!.command, hiddenLogin!.input);
            return;
        case 'tenant-terminal':
            flow.showManualInstructions(localizeAgentTenantTerminalLoginMessage(agentLabel, connectionFlow.command, connectionFlow.followUp));
            return;
        case 'hosted-restricted':
            flow.showManualInstructions(localizeHostedLocalhostOAuthAgentMessage(agentId));
            return;
        default:
            flow.showManualInstructions(localizeAgentConnectionUnsupportedMessage(agentLabel));
    }
}
