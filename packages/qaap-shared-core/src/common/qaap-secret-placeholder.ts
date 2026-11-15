// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isQaapTenantBackendMode } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';

/** Prefix of the placeholder the backend returns instead of a stored API key (`qaap-sealed-secret:<preferenceId>`). */
export const QAAP_SECRET_PLACEHOLDER_PREFIX = 'qaap-sealed-secret:';

/**
 * Preference ids whose backend consumer resolves placeholders (see QaapSecretPlaceholderResolver).
 * Only the OpenAI-compatible family (OpenRouter, NVIDIA, OpenAI) is covered: all three go through the
 * upstream `OpenAiLanguageModelsManager`. Google, Anthropic, Hugging Face and Vercel AI are not, so their
 * keys are returned as before.
 */
export const QAAP_MASKABLE_SECRET_PREFERENCE_IDS: readonly string[] = [
    'ai-features.openrouter.openrouterApiKey',
    'ai-features.nvidia.nvidiaApiKey',
    'ai-features.openAiOfficial.openAiApiKey',
];

/** Env that the tenant login is read from (QAAP_TENANT_LOGIN_ENV in qaap-adapters). */
const QAAP_TENANT_LOGIN_ENV_NAME = 'QAAP_TENANT_LOGIN';
/** Env switch: `0`, `false` or `off` disables masking on a tenant backend. */
const QAAP_MASK_USER_SECRETS_ENV = 'QAAP_MASK_USER_SECRETS';

export function toQaapSecretPlaceholder(preferenceId: string): string {
    return `${QAAP_SECRET_PLACEHOLDER_PREFIX}${preferenceId}`;
}

export function isQaapSecretPlaceholder(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(QAAP_SECRET_PLACEHOLDER_PREFIX) && value.length > QAAP_SECRET_PLACEHOLDER_PREFIX.length;
}

/** The preference id a placeholder stands for, or `undefined` when the value is not a placeholder. */
export function preferenceIdOfQaapSecretPlaceholder(value: unknown): string | undefined {
    return isQaapSecretPlaceholder(value) ? value.slice(QAAP_SECRET_PLACEHOLDER_PREFIX.length) : undefined;
}

export function isQaapMaskableSecretPreferenceId(preferenceId: string): boolean {
    return QAAP_MASKABLE_SECRET_PREFERENCE_IDS.includes(preferenceId);
}

/** The single owner a tenant backend serves, or `undefined` outside tenant-backend mode. */
export function readQaapTenantOwnerLogin(env: NodeJS.ProcessEnv = process.env): string | undefined {
    if (!isQaapTenantBackendMode(env)) {
        return undefined;
    }
    const login = env[QAAP_TENANT_LOGIN_ENV_NAME]?.trim();
    return login ? login : undefined;
}

/** Masking runs only on a tenant backend that knows its owner, unless `QAAP_MASK_USER_SECRETS` switches it off. */
export function isQaapMaskUserSecretsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    if (!readQaapTenantOwnerLogin(env)) {
        return false;
    }
    return !/^(0|false|off)$/i.test(env[QAAP_MASK_USER_SECRETS_ENV]?.trim() ?? '');
}

/**
 * Copy of settings with every non-empty allowlisted secret replaced by its placeholder. Empty or unset
 * values stay as they are, so the settings UI still knows the key is not set.
 */
export function maskQaapUserSecretsForClient(settings: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
    if (!isQaapMaskUserSecretsEnabled(env)) {
        return settings;
    }
    const masked: Record<string, unknown> = { ...settings };
    for (const preferenceId of QAAP_MASKABLE_SECRET_PREFERENCE_IDS) {
        const value = masked[preferenceId];
        if (typeof value === 'string' && value.trim() !== '') {
            masked[preferenceId] = toQaapSecretPlaceholder(preferenceId);
        }
    }
    return masked;
}
