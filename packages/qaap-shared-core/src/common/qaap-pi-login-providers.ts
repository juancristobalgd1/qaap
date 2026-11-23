// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** How Pi connects a provider: a browser account sign-in, or an API key the user pastes. */
export type QaapPiLoginMethod = 'account' | 'api_key';

/**
 * One provider Pi connects through `/login <id>` (Pi 1.5.2 / 1.6.0). Ids and names come from Pi's
 * provider definitions in `@earendil-works/pi-ai` (`providers/*.js` `id` / `name`).
 */
export interface QaapPiLoginProvider {
    /** Pi provider id, the argument of `/login <id>`. */
    readonly id: string;
    /** Name shown in the Connect dialog and the subtitle. */
    readonly name: string;
    /** Shorter name for the logo chip, when `name` does not fit two short lines. */
    readonly shortName?: string;
    /** `account`: browser sign-in (its authorize host is on the allowlist). `api_key`: the dialog asks for the key. */
    readonly method: QaapPiLoginMethod;
    /**
     * `api_key` providers that also offer an account sign-in Pi asks about first ("Select authentication
     * method"): the driver picks "Sign in with an API key", the second entry.
     */
    readonly hasAccountMethod?: boolean;
    /** Brand id for the logo ({@link resolveLlmProviderBrand}); a monogram when there is no curated logo. */
    readonly brand?: string;
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
 * Pi's API-key prompt, `Enter <provider> API key` / `Enter Hugging Face token` (`envApiKeyAuth` in
 * pi-ai). Group 1 is what Pi asks for. The prompt ends its line, so "Qwen Token Plan API key" is not cut at "Token".
 */
export const QAAP_PI_SECRET_PROMPT_PATTERN = '\\bEnter ([A-Za-z0-9][A-Za-z0-9 .()-]{0,60}? (?:API key|token))(?=[ \\t]*(?:\\r?\\n|$))';

/** Pi's line once an API key is stored: `Saved API key for Groq`. */
export const QAAP_PI_API_KEY_SAVED_PATTERN = '\\bSaved API key for\\b';

/**
 * Every provider the Connect dialog offers, in display order: the account sign-ins first (OpenRouter is
 * the default), then the API-key providers. Verified in a PTY against Pi 1.5.2 on 23 Nov 2026: each
 * API-key provider asks `Enter <name> API key` and stores `{ type: "api_key" }` in auth.json.
 *
 * Left out: xAI, Kimi and Meta account sign-ins (device-code hosts not verified for the authorize-host
 * allowlist; their API keys are offered), `openai-codex` (legacy entry of `openai`), Radius (custom
 * gateway), and providers configured outside Pi's `/login` (Amazon Bedrock, Google Vertex, Azure,
 * Cloudflare), which need more than one key.
 */
export const QAAP_PI_LOGIN_PROVIDERS: readonly QaapPiLoginProvider[] = [
    { id: 'openrouter', name: 'OpenRouter', method: 'account', brand: 'openrouter' },
    { id: 'anthropic', name: 'Anthropic (Claude Pro/Max)', shortName: 'Claude', method: 'account', brand: 'anthropic', loginScreenPattern: 'Select Anthropic login method' },
    { id: 'openai', name: 'OpenAI (ChatGPT subscription)', shortName: 'ChatGPT', method: 'account', brand: 'openai' },
    { id: 'github-copilot', name: 'GitHub Copilot', shortName: 'Copilot', method: 'account', brand: 'copilot', loginScreenPattern: 'GitHub Enterprise URL' },
    { id: 'google', name: 'Google Gemini', shortName: 'Gemini', method: 'api_key', brand: 'gemini' },
    { id: 'xai', name: 'xAI', method: 'api_key', brand: 'grok', hasAccountMethod: true },
    { id: 'deepseek', name: 'DeepSeek', method: 'api_key', brand: 'deepseek' },
    { id: 'mistral', name: 'Mistral', method: 'api_key', brand: 'mistral' },
    { id: 'groq', name: 'Groq', method: 'api_key' },
    { id: 'kimi-coding', name: 'Kimi For Coding', shortName: 'Kimi Coding', method: 'api_key', brand: 'kimi', hasAccountMethod: true },
    { id: 'moonshotai', name: 'Moonshot AI', method: 'api_key', brand: 'kimi' },
    { id: 'moonshotai-cn', name: 'Moonshot AI CN', method: 'api_key', brand: 'kimi' },
    { id: 'zai', name: 'Z.AI', method: 'api_key', brand: 'z-ai' },
    { id: 'zai-coding-cn', name: 'Z.AI Coding CN', method: 'api_key', brand: 'z-ai' },
    { id: 'qwen-token-plan', name: 'Qwen Token Plan Team', shortName: 'Qwen Team', method: 'api_key', brand: 'qwen' },
    { id: 'qwen-token-plan-individual', name: 'Qwen Token Plan Individual', shortName: 'Qwen', method: 'api_key', brand: 'qwen' },
    { id: 'qwen-token-plan-cn', name: 'Qwen Token Plan Team CN', shortName: 'Qwen Team CN', method: 'api_key', brand: 'qwen' },
    { id: 'qwen-token-plan-individual-cn', name: 'Qwen Token Plan Individual CN', shortName: 'Qwen CN', method: 'api_key', brand: 'qwen' },
    { id: 'minimax', name: 'MiniMax', method: 'api_key', brand: 'minimax' },
    { id: 'minimax-cn', name: 'MiniMax CN', method: 'api_key', brand: 'minimax' },
    { id: 'meta', name: 'Meta', method: 'api_key', brand: 'meta', hasAccountMethod: true },
    { id: 'nvidia', name: 'NVIDIA', method: 'api_key', brand: 'nvidia' },
    { id: 'huggingface', name: 'Hugging Face', method: 'api_key', brand: 'huggingface' },
    { id: 'opencode', name: 'OpenCode Zen', method: 'api_key', brand: 'opencode' },
    { id: 'opencode-go', name: 'OpenCode Go', method: 'api_key', brand: 'opencode' },
    { id: 'together', name: 'Together', method: 'api_key' },
    { id: 'fireworks', name: 'Fireworks', method: 'api_key' },
    { id: 'cerebras', name: 'Cerebras', method: 'api_key' },
    { id: 'baseten', name: 'Baseten', method: 'api_key' },
    { id: 'vercel-ai-gateway', name: 'Vercel AI Gateway', shortName: 'Vercel AI', method: 'api_key' },
    { id: 'typesafe', name: 'TypeSafe', method: 'api_key' },
    { id: 'ant-ling', name: 'Ant Ling', method: 'api_key' },
    { id: 'xiaomi', name: 'Xiaomi', method: 'api_key' },
    { id: 'xiaomi-token-plan-ams', name: 'Xiaomi Token Plan AMS', shortName: 'Xiaomi AMS', method: 'api_key' },
    { id: 'xiaomi-token-plan-cn', name: 'Xiaomi Token Plan CN', shortName: 'Xiaomi CN', method: 'api_key' },
    { id: 'xiaomi-token-plan-sgp', name: 'Xiaomi Token Plan SGP', shortName: 'Xiaomi SGP', method: 'api_key' },
];

/** Provider Pi signs in to when the Connect action does not name one. */
export const QAAP_PI_DEFAULT_LOGIN_PROVIDER = 'openrouter';

/** The supported provider with this id (case-insensitive), or `undefined`. */
export function resolvePiLoginProvider(id: string | undefined): QaapPiLoginProvider | undefined {
    const normalized = id?.trim().toLowerCase();
    return normalized ? QAAP_PI_LOGIN_PROVIDERS.find(provider => provider.id === normalized) : undefined;
}
