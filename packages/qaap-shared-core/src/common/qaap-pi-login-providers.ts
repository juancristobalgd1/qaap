// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * One provider Pi 1.4.0 signs in to with an account (OAuth / subscription) through `/login <id>`.
 * Ids and display names are taken from Pi's provider definitions in `@earendil-works/pi-ai`
 * (`providers/*.js` `id` / `name`, `auth/oauth/*.js` for the OAuth labels).
 */
export interface QaapPiLoginProvider {
    /** Pi provider id, the argument of `/login <id>`. */
    readonly id: string;
    /** Name shown in the Connect dialog and the subtitle. */
    readonly name: string;
    /**
     * An extra login screen after the method picker, answered with Enter: Anthropic's
     * `Select Anthropic login method:` (Browser login is the default), GitHub Copilot's
     * `GitHub Enterprise URL/domain` (blank means github.com). Pi's `/login` prints it, so the driver
     * waits for it before the Enter.
     */
    readonly loginScreenPattern?: string;
}

/** Pi's method picker: shown for providers that offer both an account and an API-key login. */
export const QAAP_PI_METHOD_PICKER_PATTERN = 'Select authentication method';

/**
 * Pi providers with an account sign-in, in the order the picker lists them. OpenRouter is first and
 * is the default. Pi's Google entries are not here: Pi 1.4.0 has no account sign-in for Google
 * Gemini CLI or Antigravity. `openai-codex` (Pi's legacy entry) is left out because `openai` is the
 * ChatGPT sign-in Pi offers now. `kimi-coding`, `meta`, `xai` and the custom `radius` gateway are
 * left out to keep the authorize-host allowlist to the providers verified here.
 */
export const QAAP_PI_LOGIN_PROVIDERS: readonly QaapPiLoginProvider[] = [
    { id: 'openrouter', name: 'OpenRouter' },
    { id: 'anthropic', name: 'Anthropic (Claude Pro/Max)', loginScreenPattern: 'Select Anthropic login method' },
    { id: 'openai', name: 'OpenAI (ChatGPT subscription)' },
    { id: 'github-copilot', name: 'GitHub Copilot', loginScreenPattern: 'GitHub Enterprise URL' },
];

/** Provider Pi signs in to when the Connect action does not name one. */
export const QAAP_PI_DEFAULT_LOGIN_PROVIDER = 'openrouter';

/** The supported provider with this id (case-insensitive), or `undefined`. */
export function resolvePiLoginProvider(id: string | undefined): QaapPiLoginProvider | undefined {
    const normalized = id?.trim().toLowerCase();
    return normalized ? QAAP_PI_LOGIN_PROVIDERS.find(provider => provider.id === normalized) : undefined;
}
