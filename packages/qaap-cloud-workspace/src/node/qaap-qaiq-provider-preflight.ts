// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    findQaiqByokProvider,
    listByokVendorCredentialEnv,
    QAAP_CUSTOM_OPENAI_ENDPOINTS_PREF,
    QAAP_CUSTOM_OPENAI_VENDOR,
    vendorHasByokCredential,
    vendorHasDedicatedByokCredential,
    type QaapPreferenceReader,
} from '@theia/qaap-shared-core/lib/common/qaap-qaiq-byok-provider-registry';
import { resolveQaiqEnvFallbackModel } from './qaap-agent-task-runner-utils';

/** What a QAIQ turn would authenticate with, as seen before spawning it. */
export interface QaapQaiqProviderPreflightInput {
    /** The owner's AI settings (per-user on hosted backends). */
    readonly readPref: QaapPreferenceReader;
    /** The owner's provider env, after the same stripping and Settings mapping as the real spawn. */
    readonly env: NodeJS.ProcessEnv;
    /** The model picked for this turn (composer / task routing), when there is one. */
    readonly selectedBinding?: QaapQaiqPreflightBinding;
    /** The Settings alias binding QAIQ falls back to without a pick. */
    readonly settingsBinding?: QaapQaiqPreflightBinding;
}

/** The part of a model binding the preflight reads: which provider the turn calls. */
export interface QaapQaiqPreflightBinding {
    readonly vendor: string;
}

/** Why QAIQ cannot authenticate. Every field is a name, never a credential value. */
export interface QaapQaiqProviderPreflightFailure {
    /** Vendor the turn routes to; undefined when no provider could be resolved at all. */
    readonly vendor?: string;
    /** Display name of that provider, e.g. "OpenRouter". */
    readonly providerLabel?: string;
    /** Server env variable that holds the key, e.g. `OPENROUTER_API_KEY`. */
    readonly credentialEnv?: string;
    /** Settings key that holds the key, e.g. `ai-features.openrouter.openrouterApiKey`. */
    readonly credentialPref?: string;
}

/**
 * The vendor a QAIQ turn would call, resolved like the command builder does: the turn's model pick,
 * else the Settings alias binding when it has a credential, else the env fallback model.
 */
export function resolveQaiqTurnVendor(input: QaapQaiqProviderPreflightInput): string | undefined {
    if (input.selectedBinding) {
        return input.selectedBinding.vendor;
    }
    const readEnv = (key: string): string | undefined => input.env[key];
    if (input.settingsBinding && vendorHasByokCredential(input.readPref, input.settingsBinding.vendor, readEnv)) {
        return input.settingsBinding.vendor;
    }
    return resolveQaiqEnvFallbackModel(input.env)?.vendor;
}

/**
 * `undefined` when QAIQ can authenticate with the provider its turn routes to, else what is missing.
 * Only the vendor's own key counts: an OpenAI key does not make an OpenRouter model runnable (that
 * mix reached the CLI and died as "issue with the selected model"). A vendor outside the BYOK
 * registry is left to the CLI.
 */
export function checkQaiqProviderCredential(input: QaapQaiqProviderPreflightInput): QaapQaiqProviderPreflightFailure | undefined {
    const readEnv = (key: string): string | undefined => input.env[key];
    const vendor = resolveQaiqTurnVendor(input);
    if (vendor) {
        return vendorHasDedicatedByokCredential(input.readPref, vendor, readEnv) === false
            ? describeQaiqProviderVendor(vendor)
            : undefined;
    }
    if (input.env.ANTHROPIC_API_KEY?.trim() || input.env.OPENAI_API_KEY?.trim()) {
        return undefined;
    }
    return {};
}

function describeQaiqProviderVendor(vendor: string): QaapQaiqProviderPreflightFailure {
    if (vendor.trim().toLowerCase() === QAAP_CUSTOM_OPENAI_VENDOR) {
        return { vendor, providerLabel: 'OpenAI-compatible', credentialEnv: 'OPENAI_API_KEY', credentialPref: QAAP_CUSTOM_OPENAI_ENDPOINTS_PREF };
    }
    const descriptor = findQaiqByokProvider(vendor);
    return {
        vendor,
        providerLabel: descriptor?.label,
        credentialEnv: descriptor ? listByokVendorCredentialEnv(descriptor)[0] : undefined,
        credentialPref: descriptor?.credentialPref,
    };
}

/**
 * Server-log hint for the operator (no secrets). `withheldFromOwner`: the backend never gives this
 * owner the operator's provider env (signed-in tenants, multi-user backends), so only the user's
 * own Settings key can fix their turns.
 */
export function formatQaiqProviderOperatorHint(failure: QaapQaiqProviderPreflightFailure, withheldFromOwner: boolean): string {
    const label = failure.providerLabel ?? 'AI provider';
    const envName = failure.credentialEnv ?? 'OPENROUTER_API_KEY (or GEMINI_API_KEY, NVIDIA_API_KEY, …)';
    const pref = failure.credentialPref ?? 'ai-features.<provider>.*ApiKey';
    const head = `[qaap-agent-tasks] QAIQ turn refused before spawn: no ${label} API key`
        + (failure.vendor ? ` (the turn's model routes to ${failure.vendor}).` : ' (no model provider is configured).');
    if (withheldFromOwner) {
        return `${head} Signed-in users never receive the server's ${envName} (operator provider keys are withheld from tenants by design), `
            + `so each user must add their own key in Settings → AI Features (${pref}). Setting ${envName} in /opt/qaap/.env only covers `
            + 'local / skip-auth runs. Users can also pick another signed-in agent.';
    }
    return `${head} Set ${envName} in the server env (Docker: uncomment it in /opt/qaap/.env — docker-compose.yml passes it to the theia `
        + `service — then \`docker compose up -d theia\`), or add the key in Settings → AI Features (${pref}).`;
}

const loggedQaiqProviderHints = new Set<string>();

/** Logs {@link formatQaiqProviderOperatorHint} once per process for each provider / audience. */
export function logQaiqProviderOperatorHintOnce(
    failure: QaapQaiqProviderPreflightFailure,
    withheldFromOwner: boolean,
    warn: (message: string) => void = message => console.warn(message),
    logged: Set<string> = loggedQaiqProviderHints,
): boolean {
    const key = `${failure.vendor ?? '*'}|${withheldFromOwner ? 'tenant' : 'operator'}`;
    if (logged.has(key)) {
        return false;
    }
    logged.add(key);
    warn(formatQaiqProviderOperatorHint(failure, withheldFromOwner));
    return true;
}
