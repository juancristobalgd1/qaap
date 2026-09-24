// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { normalizePreviewUrlForSameOrigin, parsePreviewProxyPath } from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import type { QaapAgentConversationDTO } from '../common/qaap-agent-conversation-client';
import {
    isLocalQaapPreviewOrigin,
    parseQaapIdentityPreviewRequestPath,
    resolveDevPreviewPublicOrigin,
} from '../common/qaap-dev-preview';
import {
    resolveReadyTranscriptPreviewUrlFromProbe,
    type TranscriptPreviewPortProbeResult,
} from '../common/qaap-transcript-preview-offer';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { probeQaapDevPreviewPort, probeQaapIdentityPreview, waitForQaapDevPreviewPort } from './qaap-dev-preview-client';
import { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);
const BOOTSTRAP_PREVIEW_WAIT_MS = 180_000;
const PROBE_POLL_ATTEMPTS = 60;
const PROBE_POLL_INTERVAL_MS = 250;

export interface EnsureTranscriptDevPreviewOptions {
    readonly portHint?: number;
    readonly previewUrlHint?: string;
    /** When set, only wait for an hinted port — never start bootstrap install/dev. */
    readonly waitForHintOnly?: boolean;
    /** When set, probe transcript-derived ports before spawning install/dev. */
    readonly conversation?: QaapAgentConversationDTO;
    /** Visual verification uses project bootstrap only; transcript prose may mention another app's port. */
    readonly skipConversationPortProbe?: boolean;
    /** Work Hub project identity for bootstrap root selection. */
    readonly projectId?: string;
    /** Work Hub section / conversation id — each section keeps an independent preview claim. */
    readonly conversationId?: string;
    /** Authoritative project root when it differs from the conversation cwd. */
    readonly workspaceRoot?: string;
}

/** Parses a proxied or direct localhost preview URL into a dev-server port. */
export function extractDevPreviewPortFromUrl(url: string | undefined): number | undefined {
    if (!url?.trim()) {
        return undefined;
    }
    try {
        const parsed = new URL(url.trim(), resolveDevPreviewPublicOrigin());
        // Identity URLs live on the IDE origin (`:3000/qaap-preview/<id>/`). That host port is
        // the Work Hub itself — never a preview process. Treating it as port 3000 made Preview
        // probe Theia, fail, and stay on the empty "Enter a URL" overlay.
        if (parseQaapIdentityPreviewRequestPath(parsed.pathname)) {
            return undefined;
        }
        const proxy = parsePreviewProxyPath(parsed.pathname);
        if (proxy) {
            return proxy.port;
        }
        if (LOCAL_DEV_HOSTS.has(parsed.hostname)) {
            const port = Number(parsed.port);
            return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : undefined;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

async function probeReadyPreviewUrl(port: number): Promise<string | undefined> {
    const probe = await probeQaapDevPreviewPort(port);
    if (!probe.ready) {
        return undefined;
    }
    return normalizePreviewUrlForSameOrigin(probe.previewUrl);
}

async function probeTranscriptConversationPorts(
    conversation: QaapAgentConversationDTO | undefined,
): Promise<string | undefined> {
    if (!conversation) {
        return undefined;
    }
    return resolveReadyTranscriptPreviewUrlFromProbe(
        conversation,
        async (port: number): Promise<TranscriptPreviewPortProbeResult> => {
            const probe = await probeQaapDevPreviewPort(port);
            return {
                ready: probe.ready,
                previewUrl: normalizePreviewUrlForSameOrigin(probe.previewUrl),
            };
        },
    );
}

export interface QaapTrustedBootstrapPreviewState {
    readonly previewUrl?: string;
    readonly lastPort?: number;
    readonly activePort?: number;
}

/** Ports tied to this workspace's own bootstrap history; framework defaults are intentionally excluded. */
export function collectTrustedBootstrapPreviewPorts(snapshot: QaapTrustedBootstrapPreviewState): readonly number[] {
    const ports: number[] = [];
    const push = (port: number | undefined): void => {
        if (port !== undefined && !ports.includes(port)) {
            ports.push(port);
        }
    };
    push(extractDevPreviewPortFromUrl(snapshot.previewUrl));
    push(snapshot.lastPort);
    push(snapshot.activePort);
    return ports;
}

function collectBootstrapProbePorts(
    bootstrap: QaapProjectBootstrapService,
): readonly number[] {
    return collectTrustedBootstrapPreviewPorts(bootstrap.getStateSnapshot());
}

async function probeBootstrapListeningPorts(
    bootstrap: QaapProjectBootstrapService,
): Promise<string | undefined> {
    for (const port of collectBootstrapProbePorts(bootstrap)) {
        const readyUrl = await probeReadyPreviewUrl(port);
        if (readyUrl) {
            return readyUrl;
        }
    }
    return undefined;
}

const CLAIM_PROBE_INTERVAL_MS = 1_000;

/**
 * Transcript settlement and visual-verification autopilot can request the same preview in the
 * same turn. Keep one bootstrap transaction per service so both callers observe the same claim
 * and terminal instead of racing two reservations for the same project.
 */
const transcriptPreviewBootstrapInFlight = new WeakMap<
    QaapProjectBootstrapService,
    Map<string, Promise<string | undefined>>
>();

function transcriptPreviewBootstrapRequestKey(options: EnsureTranscriptDevPreviewOptions): string {
    return options.conversationId
        ?? options.conversation?.id
        ?? options.projectId
        ?? options.workspaceRoot
        ?? 'workspace';
}

function waitForBootstrapPreviewUrl(
    bootstrap: QaapProjectBootstrapService,
    timeoutMs: number,
): Promise<string | undefined> {
    const snapshot = bootstrap.getStateSnapshot();
    if (snapshot.previewUrl && snapshot.phase === 'running') {
        return Promise.resolve(snapshot.previewUrl);
    }
    return new Promise(resolve => {
        const toDispose = new DisposableCollection();
        const finish = (url: string | undefined): void => {
            toDispose.dispose();
            resolve(url);
        };
        toDispose.push(Disposable.create(() => {
            window.clearTimeout(timerId);
            window.clearInterval(claimTimerId);
        }));
        toDispose.push(bootstrap.onStateChange(state => {
            if (state.previewUrl && state.phase === 'running') {
                finish(state.previewUrl);
            } else if (state.phase === 'install-failed' || state.phase === 'run-failed') {
                // The managed terminal already reported a definitive failure. Do not leave Work
                // Hub spinning until the outer three-minute safety deadline expires.
                finish(undefined);
            }
        }));
        // The state-change path depends on spotting the dev server's banner in terminal output —
        // fragile (custom banners, cleared terminals, missed events). The reservation already
        // knows the authoritative identity, so poll it directly: the moment the process answers
        // through the identity proxy, the preview is ready regardless of what the terminal said.
        let claimProbeInFlight = false;
        const claimTimerId = window.setInterval(() => {
            const previewId = bootstrap.previewId;
            const claimUrl = bootstrap.previewClaimUrl;
            if (!previewId || !claimUrl || claimProbeInFlight) {
                return;
            }
            claimProbeInFlight = true;
            probeQaapIdentityPreview(previewId).then(probe => {
                claimProbeInFlight = false;
                if (probe.ready && probe.previewId === previewId) {
                    finish(probe.previewUrl || claimUrl);
                }
            }, () => { claimProbeInFlight = false; });
        }, CLAIM_PROBE_INTERVAL_MS);
        const timerId = window.setTimeout(() => finish(undefined), timeoutMs);
    });
}

/**
 * Keeps the dev server alive via {@link QaapProjectBootstrapService} (persistent terminal) instead
 * of agent shell commands that time out after ~30s. Returns a same-origin preview URL when ready.
 */
async function ensureTranscriptDevPreviewExtracted(
    bootstrap: QaapProjectBootstrapService,
    options: EnsureTranscriptDevPreviewOptions = {},
): Promise<string | undefined> {
    const projectRoot = options.workspaceRoot
        ?? options.conversation?.parallelBaseCwd
        ?? options.conversation?.cwd;
    if (projectRoot) {
        await bootstrap.refreshFromProjectRoot(projectRoot, options.projectId ?? projectRoot);
    }

    // On a shared VPS a prose-derived bare port has no project identity. It may be another app
    // owned by the same user, so only the single-user/local path retains this compatibility probe.
    const fromConversation = options.skipConversationPortProbe
        || !isLocalQaapPreviewOrigin(resolveDevPreviewPublicOrigin())
        ? undefined
        : await probeTranscriptConversationPorts(options.conversation);
    if (fromConversation) {
        return fromConversation;
    }

    const localPreviewRuntime = isLocalQaapPreviewOrigin(resolveDevPreviewPublicOrigin());
    const portHint = localPreviewRuntime
        ? options.portHint ?? extractDevPreviewPortFromUrl(options.previewUrlHint)
        : undefined;

    if (portHint !== undefined) {
        const readyUrl = await probeReadyPreviewUrl(portHint);
        if (readyUrl) {
            return readyUrl;
        }
        const waited = await waitForQaapDevPreviewPort(portHint, {
            maxAttempts: PROBE_POLL_ATTEMPTS,
            intervalMs: PROBE_POLL_INTERVAL_MS,
        });
        if (waited?.ready) {
            return normalizePreviewUrlForSameOrigin(waited.previewUrl);
        }
        if (options.waitForHintOnly || options.previewUrlHint || options.portHint) {
            return undefined;
        }
    }

    let snapshot = bootstrap.getStateSnapshot();
    if (!snapshot.descriptor) {
        if (projectRoot) {
            // An explicit project root was requested and yielded no runnable descriptor. Falling
            // back to the *currently open* workspace here would detect and start a DIFFERENT
            // project's dev server and record its URL onto this one (the historic cross-project
            // previewUrl poisoning). Fail instead; the caller surfaces the error.
            return undefined;
        }
        await bootstrap.refreshFromCurrentWorkspace();
        snapshot = bootstrap.getStateSnapshot();
    }
    if (!snapshot.descriptor) {
        return undefined;
    }

    const alreadyListening = await probeBootstrapListeningPorts(bootstrap);
    if (alreadyListening) {
        return alreadyListening;
    }

    if (snapshot.previewUrl && snapshot.phase === 'running') {
        const runningPort = extractDevPreviewPortFromUrl(snapshot.previewUrl);
        if (runningPort !== undefined) {
            const readyUrl = await probeReadyPreviewUrl(runningPort);
            if (readyUrl) {
                return readyUrl;
            }
        }
    }

    const needsInstall = snapshot.needsInstall === true
        || !snapshot.descriptor.nodeModulesPresent
        || snapshot.phase === 'install-failed';
    const conversationId = options.conversationId ?? options.conversation?.id;

    if (needsInstall) {
        await bootstrap.runInstall();
    } else {
        await bootstrap.runDevServer({ conversationId });
    }

    const fromBootstrap = await waitForBootstrapPreviewUrl(bootstrap, BOOTSTRAP_PREVIEW_WAIT_MS);
    if (!fromBootstrap) {
        return undefined;
    }
    const finalPort = extractDevPreviewPortFromUrl(fromBootstrap);
    if (finalPort === undefined) {
        return normalizePreviewUrlForSameOrigin(fromBootstrap);
    }
    const verified = await probeReadyPreviewUrl(finalPort);
    return verified ?? normalizePreviewUrlForSameOrigin(fromBootstrap);
}

export function ensureTranscriptDevPreview(
    bootstrap: QaapProjectBootstrapService,
    options: EnsureTranscriptDevPreviewOptions = {},
): Promise<string | undefined> {
    const requestKey = transcriptPreviewBootstrapRequestKey(options);
    const requests = transcriptPreviewBootstrapInFlight.get(bootstrap);
    const inFlight = requests?.get(requestKey);
    if (inFlight) {
        return inFlight;
    }

    const pending = ensureTranscriptDevPreviewExtracted(bootstrap, options);
    const requestMap = requests ?? new Map<string, Promise<string | undefined>>();
    requestMap.set(requestKey, pending);
    transcriptPreviewBootstrapInFlight.set(bootstrap, requestMap);
    const clearRequest = (): void => {
        if (requestMap.get(requestKey) === pending) {
            requestMap.delete(requestKey);
            if (requestMap.size === 0) {
                transcriptPreviewBootstrapInFlight.delete(bootstrap);
            }
        }
    };
    void pending.then(clearRequest, clearRequest);
    return pending;
}
