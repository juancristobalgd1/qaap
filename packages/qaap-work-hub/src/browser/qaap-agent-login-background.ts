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
    resolveAgentLoginChallengeTimeoutMs,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-auth-login';
import { localizeHostedLocalhostOAuthAgentMessage } from '@theia/qaap-shared-core/lib/common/qaap-hosted-agent-auth-policy';
import { buildAgentLoginShellCommand, splitAgentLoginShellInput } from '@theia/qaap-shared-core/lib/common/qaap-agent-connect-plan';
import {
    attestAgentSessionSignIn,
    invalidateAgentModelsCache,
    invalidateAgentTaskListAllCache,
    QAAP_AGENT_TASK_API_PATH,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { isQaapSessionAttestationAgent } from '@theia/qaap-shared-core/lib/common/qaap-agent-session-attestation';
import {
    resolveAgentConnectionFlow,
    type QaapAgentConnectionFlow,
    type QaapAgentLoginInputStep,
    QAAP_AGY_TUI_LOGIN_COMMAND,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-tui-command';
import {
    resolveQaapHarnessAuthProfile,
    type QaapHarnessLoginPhase,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-auth-profile';
import { QAAP_PI_API_KEY_SAVED_PATTERN, QAAP_PI_LOGIN_PROVIDERS, QAAP_PI_SECRET_PROMPT_PATTERN } from '@theia/qaap-shared-core/lib/common/qaap-pi-login-providers';
import { resolvePiProviderMarkSvg } from '@theia/qaap-shared-core/lib/common/qaap-pi-provider-marks';
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
import { QAAP_AGENT_SIGNED_IN_EVENT, type QaapAgentSignedInDetail } from './qaap-agent-signed-in-event';
import { presentAgyLoginFailure, QAAP_AGY_LOGIN_CHALLENGE_TIMEOUT_MS } from '@theia/qaap-agents-ui/lib/common/qaap-agy-login-presentation';
import { QaapAgentLoginInputDriver } from '@theia/qaap-agents-ui/lib/common/qaap-agent-login-input-driver';
import { QaapAgentLoginPromptResponderDriver } from '@theia/qaap-agents-ui/lib/common/qaap-agent-login-prompt-responder';
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
    /** Server-validated binary override for Connect on desktop (e.g. an instance's custom binary). */
    readonly loginBinaryPath?: string;
    /** Server-validated configuration folder env (`CODEX_HOME` / `CLAUDE_CONFIG_DIR`) for Connect on desktop. */
    readonly loginEnv?: Readonly<Record<string, string>>;
    /** Validation failure message when the harness's configured binary/folder override is invalid. */
    readonly loginOverrideError?: string;
}

function wait(milliseconds: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

/** Longest wait for the shell's first prompt before the login command is typed anyway. */
const SHELL_PROMPT_WAIT_MS = 3_000;
/** Pause between command pieces, so the shell drains the PTY input queue between writes. */
const SHELL_INPUT_CHUNK_GAP_MS = 25;

/**
 * Types a long command into the hidden terminal. Text written before the shell reads its line
 * editor input sits in the kernel's canonical queue, and macOS drops input past 1024 bytes there
 * and in one raw write: the command's tail and its Enter were lost, so it never ran. Waiting for
 * the first prompt and writing small pieces keeps every byte.
 */
async function typeAgentLoginCommand(
    terminal: { sendText(text: string): void; readonly isDisposed: boolean },
    line: string,
    hasPrompt: () => boolean,
    stillCurrent: () => boolean,
): Promise<void> {
    const promptDeadline = Date.now() + SHELL_PROMPT_WAIT_MS;
    while (!hasPrompt() && Date.now() < promptDeadline && stillCurrent() && !terminal.isDisposed) {
        await wait(50);
    }
    const chunks = splitAgentLoginShellInput(line);
    for (let index = 0; index < chunks.length; index++) {
        if (!stillCurrent() || terminal.isDisposed) {
            return;
        }
        if (index > 0) {
            await wait(SHELL_INPUT_CHUNK_GAP_MS);
        }
        terminal.sendText(chunks[index]);
    }
}

/** True once the terminal shows any text (the shell's first prompt). */
function hasBufferText(terminal: { readonly buffer?: { readonly length: number; getLines(start: number, length: number, trimRight?: boolean): string[] } }): boolean {
    const buffer = terminal.buffer;
    if (!buffer || buffer.length === 0) {
        return false;
    }
    return buffer.getLines(0, buffer.length, true).some(line => line.trim().length > 0);
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
        ? { command: connectionFlow.command, env: connectionFlow.env }
        : connectionFlow.kind === 'tui-login'
            ? { command: connectionFlow.command, input: connectionFlow.input, env: connectionFlow.env }
            : undefined;
}

/** Antigravity sign-in dialogs that are open: one per harness, so a second tap never starts a second `agy`. */
const openAntigravityLoginDialogs = new Set<string>();

function isAntigravityLoginAgent(agentId: string): boolean {
    const normalized = agentId.trim().toLowerCase();
    return normalized === 'antigravity' || normalized === 'gemini';
}

/**
 * The connection probe of a caller that passed none (the side chat's Sign in): the same refresh every Connect
 * flow ends in (`refreshAfterAgentSignIn`): drop the cached agent list and models, re-read the harness state
 * from the backend and redraw the composer. True once the harness reads as connected.
 */
function createDefaultConnectionProbe(ctx: any, project: MobileProjectEntry | undefined, agentId: string): (() => Promise<boolean>) | undefined {
    if (!project) {
        return undefined;
    }
    return async () => {
        invalidateAgentTaskListAllCache();
        invalidateAgentModelsCache();
        // Only this harness is re-probed: this runs every 2.5 s while the dialog waits for the sign-in.
        const refreshed = await ctx.stickyComposerAgentsUi?.refreshStickyComposerAgents?.(project, { forceRefresh: true, refreshAgent: agentId });
        await ctx.transcriptComposerUi?.refreshTranscriptComposerAgents?.(project);
        ctx.stickyComposerRenderUi?.renderStickyComposer?.();
        return refreshed === true && ctx.stickyComposerAgentsUi?.isAgentConnected?.(agentId) === true;
    };
}

export async function openAgentLoginDialogInBackground(
    ctx: any,
    project: MobileProjectEntry | undefined,
    summary: QaapAgentConversationSummaryDTO | undefined,
    agentId: string,
    callerOnConnected?: () => boolean | void | Promise<boolean | void>,
): Promise<void> {
    const onConnected = callerOnConnected ?? createDefaultConnectionProbe(ctx, project, agentId);
    const agentLabel = resolveAgentDisplayLabel(agentId);
    const singleFlightKey = isAntigravityLoginAgent(agentId) ? 'antigravity' : undefined;
    if (singleFlightKey && openAntigravityLoginDialogs.has(singleFlightKey)) {
        return;
    }
    if (singleFlightKey) {
        openAntigravityLoginDialogs.add(singleFlightKey);
    }
    // Pi's provider can be switched in the dialog: the flow and its keystrokes follow the choice.
    let connectionFlow = resolveAgentConnectionFlow(agentId);
    let hiddenLogin = resolveHiddenLogin(connectionFlow);
    let authProfile = resolveQaapHarnessAuthProfile(agentId);

    let staging: HTMLElement | undefined;
    let surface: any;
    let outputListener: { dispose(): void } | undefined;
    let watchdogHandle: number | undefined;
    let inputDriver: QaapAgentLoginInputDriver | undefined;
    let inputDriverHandle: number | undefined;
    let promptResponderDriver: QaapAgentLoginPromptResponderDriver | undefined;
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
    /** The resolved CLI is `agy`: its Google OAuth picker is driven and its failures get their own copy. */
    let agyLogin = false;

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

    const stopPromptResponderDriver = (): void => {
        promptResponderDriver?.stop();
        promptResponderDriver = undefined;
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
        stopPromptResponderDriver();
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
        if (singleFlightKey) {
            openAntigravityLoginDialogs.delete(singleFlightKey);
        }
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
        'Terminal started: {0}. Output received: {1} bytes from the live stream, {2} more bytes recovered from the terminal screen.',
        facts.opened ? nls.localize('qaap/agentLogin/diagnosticsYes', 'yes') : nls.localize('qaap/agentLogin/diagnosticsNo', 'no'),
        String(facts.onOutputBytes),
        String(facts.bufferBytes),
    );

    /**
     * Undetectable-session harnesses (Copilot) have no probe that distinguishes signed-out from
     * unconfigured: attest the CLI's success line on the server first, then drop the cached agent
     * list and models so every listener (composer, side chat, Settings → Harness) reads the fresh state.
     */
    const attestSignInIfUnprobed = async (): Promise<void> => {
        if (!agyLogin && isQaapSessionAttestationAgent(agentId)) {
            if (!await attestAgentSessionSignIn(agentId)) {
                console.warn('[qaap] Agent sign-in attestation was refused', { agentId });
            }
        }
        invalidateAgentTaskListAllCache();
        invalidateAgentModelsCache(agentId);
    };

    /** Driven TUI logins type their way to the link; some CLIs do slow first-run work before printing it. */
    function resolveLoginChallengeTimeout(): { challengeTimeoutMs?: number } {
        const challengeTimeoutMs = agyLogin
            ? QAAP_AGY_LOGIN_CHALLENGE_TIMEOUT_MS
            : authProfile?.login.challengeTimeoutMs
                ?? (connectionFlow.kind === 'tui-login'
                    ? TUI_LOGIN_CHALLENGE_TIMEOUT_MS
                    : resolveAgentLoginChallengeTimeoutMs(agentId));
        return challengeTimeoutMs !== undefined ? { challengeTimeoutMs } : {};
    }

    const flow = new QaapAgentLoginFlow({
        agentId,
        // Read at each tick: the resolved CLI (and with it agy's deadline) is only known after the status check.
        get challengeTimeoutMs(): number | undefined {
            return resolveLoginChallengeTimeout().challengeTimeoutMs;
        },
        get answersPrompts(): boolean {
            return agyLogin || authProfile?.login.answersPrompts === true;
        },
        get alwaysAcceptsCode(): boolean {
            return agyLogin || authProfile?.login.alwaysAcceptsCode === true;
        },
        get extraSuccessPatterns(): readonly string[] | undefined {
            const profile = authProfile?.login.extraSuccessPatterns;
            // Pi stores a pasted API key at once and says so; no browser step follows.
            return agentId === 'pi' ? [...(profile ?? []), QAAP_PI_API_KEY_SAVED_PATTERN] : profile;
        },
        get secretPromptPattern(): string | undefined {
            return agentId === 'pi' ? QAAP_PI_SECRET_PROMPT_PATTERN : undefined;
        },
        get extraFailurePatterns(): readonly string[] | undefined {
            return authProfile?.login.extraFailurePatterns;
        },
        onDidChange: state => {
            if (closed) {
                return;
            }
            dialog.render(agyLogin && state.phase === 'failed' ? presentAgyLoginFailure(state, agentLabel) : state);
            if (state.phase === 'connected') {
                disposeTerminal();
                void attestSignInIfUnprobed().then(() => {
                    window.dispatchEvent(new window.CustomEvent<QaapAgentSignedInDetail>(QAAP_AGENT_SIGNED_IN_EVENT, { detail: { agentId } }));
                    return onConnected?.();
                }).catch(error => {
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
            const activeLoginPhase = (): QaapHarnessLoginPhase | undefined => {
                const phase = flow.state.phase;
                return phase === 'waiting' || phase === 'challenge' || phase === 'code-submitted' ? phase : undefined;
            };
            const responders = authProfile?.login.postChallengeResponders;
            if (responders?.length) {
                promptResponderDriver = new QaapAgentLoginPromptResponderDriver({
                    responders,
                    send: text => {
                        if (!closed && currentAttempt === attempt && !liveTerminal.isDisposed) {
                            liveTerminal.sendText(text);
                        }
                    },
                });
            }
            outputListener = liveTerminal.onOutput((chunk: string) => {
                onOutputBytes += agentLoginUtf8ByteLength(chunk);
                bufferTap?.noteOutput();
                const stripped = stripAgentLoginTerminalControlSequences(chunk);
                inputDriver?.feed(stripped, Date.now());
                flow.appendRawOutput(chunk);
                const phase = activeLoginPhase();
                if (phase) {
                    promptResponderDriver?.feed(stripped, phase);
                }
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
                    const phase = activeLoginPhase();
                    if (phase) {
                        promptResponderDriver?.feed(text, phase);
                    }
                },
                columns: () => (liveTerminal as unknown as { term?: { cols?: number } }).term?.cols,
            });
            tap.noteOutput();
            bufferTap = tap;
            flow.commandStarted(Date.now());
            const loginEnv: Record<string, string> | undefined = hiddenLogin?.env || status?.loginEnv
                ? { ...(hiddenLogin?.env ?? {}), ...(status?.loginEnv ?? {}) }
                : undefined;
            await typeAgentLoginCommand(
                liveTerminal,
                `${buildAgentLoginShellCommand(command, {
                    cliBinDirectory: status?.cliBinDirectory,
                    binaryPath: status?.loginBinaryPath,
                    platform: runtimePlatform(),
                    env: loginEnv,
                })}\r`,
                () => onOutputBytes > 0 || hasBufferText(liveTerminal),
                () => !closed && currentAttempt === attempt,
            );
            if (closed || currentAttempt !== attempt || liveTerminal.isDisposed) {
                return;
            }
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

    /** The harness status of the last start: a provider switch reuses it (same CLI, same install). */
    let lastHarnessStatus: AgentLoginHarnessStatus | undefined;
    /** Bumped by every start, so an older start still waiting on its status never runs after a newer one. */
    let loginGeneration = 0;
    const startCliLogin = async (
        command: string,
        input?: readonly QaapAgentLoginInputStep[],
        options?: { readonly reuseStatus?: boolean },
    ): Promise<void> => {
        const generation = ++loginGeneration;
        flow.restart(Date.now());
        // `harness-status` probes every harness and can take seconds on a busy backend: switching Pi's
        // provider does not change the CLI, so it reuses the status instead of waiting on it again.
        const status = options?.reuseStatus && lastHarnessStatus ? lastHarnessStatus : await fetchAgentLoginHarnessStatus(agentId);
        if (closed || generation !== loginGeneration || flow.state.phase !== 'preparing') {
            return;
        }
        lastHarnessStatus = status ?? lastHarnessStatus;
        if (status?.loginOverrideError) {
            flow.showManualInstructions(status.loginOverrideError);
            return;
        }
        if (status && status.installed === false) {
            const canInstall = status.installSupported === true && status.installPackageAvailable !== false;
            flow.requireInstall(canInstall, canInstall ? undefined : localizeInstallBlockedMessage(agentLabel, status));
            return;
        }
        authProfile = resolveQaapHarnessAuthProfile(agentId, { cliBin: status?.cliBin }) ?? authProfile;
        // The resolved Antigravity CLI decides the sign-in. `agy` has no login command: its Google OAuth picker
        // is driven in the hidden terminal and the authorization URL it prints is opened by the user (the
        // callback is hosted by Google, so any browser works). Other CLIs without a login get instructions.
        const resolvedFlow = resolveAgentConnectionFlow(agentId, { cliBin: status?.cliBin });
        if (resolvedFlow.kind === 'tui-login' && resolvedFlow.command === QAAP_AGY_TUI_LOGIN_COMMAND && isAntigravityLoginAgent(agentId)) {
            agyLogin = true;
            connectionFlow = resolvedFlow;
            hiddenLogin = resolveHiddenLogin(resolvedFlow);
            await runLogin(resolvedFlow.command, status, resolvedFlow.input);
            return;
        }
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
        void startCliLogin(next.command, next.input, { reuseStatus: true });
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
        ...(connectionFlow.kind === 'tui-login' && connectionFlow.provider !== undefined ? {
            loginProviders: {
                options: QAAP_PI_LOGIN_PROVIDERS.map(provider => ({
                    id: provider.id,
                    label: provider.name,
                    ...(provider.shortName ? { shortLabel: provider.shortName } : {}),
                    method: provider.method,
                    ...(provider.brand ? { brand: provider.brand } : {}),
                    ...(resolvePiProviderMarkSvg(provider.id) ? { logoSvg: resolvePiProviderMarkSvg(provider.id) } : {}),
                })),
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
        onSubmitSecret: secret => {
            if (!surface || surface.terminal.isDisposed) {
                return;
            }
            // Redacted from the kept output first: the TUI echoes what it is typed.
            flow.secretSubmitted(secret, Date.now());
            surface.terminal.sendText(`${secret}\r`);
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
