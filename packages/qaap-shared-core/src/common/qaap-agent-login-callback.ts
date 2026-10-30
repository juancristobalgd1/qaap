// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Loopback-callback bridge for agent sign-ins whose CLI waits on a `127.0.0.1` listener (Pi's
 * OpenRouter PKCE login). On a hosted workspace that listener lives in the tenant container, so
 * the provider's redirect can never reach it from the user's browser. The sign-in page is opened
 * with its `callback_url` pointed at {@link QAAP_AGENT_LOGIN_CALLBACK_PATH} on the Qaap origin;
 * that page broadcasts its query on {@link QAAP_AGENT_LOGIN_CALLBACK_CHANNEL} and the login dialog
 * rebuilds the original loopback redirect URL and pastes it into the CLI's prompt.
 */
export const QAAP_AGENT_LOGIN_CALLBACK_PATH = '/qaap/agent-login/callback';

/** `BroadcastChannel` name shared by the callback page and the login dialog (same origin). */
export const QAAP_AGENT_LOGIN_CALLBACK_CHANNEL = 'qaap-agent-login-callback';

/** Message the callback page posts: the nonce from its path and its own `location.search`. */
export interface QaapAgentLoginCallbackMessage {
    readonly nonce: string;
    readonly search: string;
}

export interface QaapAgentLoginCallbackRewrite {
    /** Sign-in URL whose `callback_url` now points at the Qaap callback page. */
    readonly url: string;
    /** The loopback callback the CLI listens on; the redirect is rebuilt against it. */
    readonly loopbackCallback: string;
}

const CALLBACK_PARAM = 'callback_url';
const NONCE_RE = /^[A-Za-z0-9-]{8,64}$/;

function isLoopbackHostname(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '::1' || host.endsWith('.localhost') || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function isQaapAgentLoginCallbackNonce(value: unknown): value is string {
    return typeof value === 'string' && NONCE_RE.test(value);
}

/**
 * Points a sign-in URL's loopback `callback_url` at the Qaap callback page. Returns `undefined`
 * when there is nothing to bridge: no loopback callback, or the app itself is served from a
 * loopback origin (the browser reaches the CLI's listener directly, as on a local install).
 */
export function rewriteQaapAgentLoginCallbackUrl(
    signInUrl: string,
    appOrigin: string,
    nonce: string,
): QaapAgentLoginCallbackRewrite | undefined {
    if (!isQaapAgentLoginCallbackNonce(nonce)) {
        return undefined;
    }
    let url: URL;
    let origin: URL;
    try {
        url = new URL(signInUrl);
        origin = new URL(appOrigin);
    } catch {
        return undefined;
    }
    if (origin.protocol !== 'https:' && origin.protocol !== 'http:') {
        return undefined;
    }
    if (isLoopbackHostname(origin.hostname)) {
        return undefined;
    }
    const callback = url.searchParams.get(CALLBACK_PARAM);
    if (!callback) {
        return undefined;
    }
    let loopback: URL;
    try {
        loopback = new URL(callback);
    } catch {
        return undefined;
    }
    if (loopback.protocol !== 'http:' || !isLoopbackHostname(loopback.hostname)) {
        return undefined;
    }
    url.searchParams.set(CALLBACK_PARAM, `${origin.origin}${QAAP_AGENT_LOGIN_CALLBACK_PATH}/${nonce}`);
    return { url: url.toString(), loopbackCallback: loopback.toString() };
}

/**
 * Rebuilds the redirect the CLI expected (`http://127.0.0.1:<port>/…?code=…`) from the loopback
 * callback and the query the provider appended to the Qaap callback page.
 */
export function resolveQaapAgentLoginRedirectUrl(loopbackCallback: string, search: string): string | undefined {
    let redirect: URL;
    try {
        redirect = new URL(loopbackCallback);
    } catch {
        return undefined;
    }
    const params = new URLSearchParams(search);
    if (![...params.keys()].length) {
        return undefined;
    }
    params.forEach((value, key) => redirect.searchParams.set(key, value));
    return redirect.toString();
}
