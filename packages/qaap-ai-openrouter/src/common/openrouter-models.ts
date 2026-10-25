// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Provider id used to namespace OpenRouter language model ids (`openrouter/<model>`). */
export const OPENROUTER_PROVIDER_ID = 'openrouter';

/** Suffix OpenRouter appends to model slugs to mark them as free-tier. */
export const OPENROUTER_FREE_SUFFIX = ':free';

/**
 * Curated set of popular OpenRouter free-tier models (slugs end with `:free`). OpenRouter
 * routes these to provider endpoints (DeepInfra, Together, etc.) and serves them at no cost,
 * subject to a shared free-tier rate limit (~20 req/min, 200 req/day per account).
 *
 * The full catalog at https://openrouter.ai/models?max_price=0 changes frequently — users can
 * add or remove entries in the {@link MODELS_PREF} preference.
 */
/**
 * Slugs that must not be registered or shown as free. OpenRouter may keep a `:free` suffix in the
 * catalog even when every endpoint is paid or offline.
 */
export const OPENROUTER_EXCLUDED_MODEL_SLUGS: ReadonlySet<string> = new Set([
    'deepseek/deepseek-v4-flash:free',
    // Hunyuan free endpoint accepts `tools` but emits tool-call args as plain text — unusable for Agent.
    'tencent/hy3:free',
    'tencent/hy3',
    // Hermes catalog copies that 404 on OpenRouter (`No endpoints found`) as of 2026-08-17.
    // (`nvidia/nemotron-3-ultra-550b-a55b:free` was here until its Nvidia endpoint came back live;
    // it is the QAIQ default since 2026-10-21.)
    'poolside/laguna-m.1:free',
    'inclusionai/ring-2.6-1t:free',
    'openrouter/elephant-alpha',
    'openrouter/pareto-code',
    // Delisted from the OpenRouter catalog (only paid variants remain) as of 2026-09-24; QAIQ fails
    // with "model may not exist" when a saved pick still points at them.
    'moonshotai/kimi-k2.6:free',
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'openai/gpt-oss-120b:free',
    'z-ai/glm-4.5-air:free',
    'nousresearch/hermes-3-llama-3.1-405b:free',
    // Not in the OpenRouter catalog as of 2026-10-25 (`/api/v1/models` has only the paid
    // `minimax/minimax-m3.1-flash`): every turn on it failed with "may not exist or you may not have
    // access" and fell back silently. Removed from the curated list; the paid slug is not a free pick.
    'minimax/minimax-m3.1-flash:free',
]);

/** Default OpenRouter endpoint. It is OpenAI Chat-Completions compatible. */
export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export const OPENROUTER_DEFAULT_FREE_MODELS: readonly string[] = [
    // The OpenRouter free catalog (https://openrouter.ai/models?max_price=0) churns frequently —
    // upstream sponsors go offline (status -2/-5) without the slug being removed from the catalog,
    // which is what produces the runtime `404 No endpoints found for X:free`. The entries below
    // were verified by querying each model's `/endpoints` and keeping only the ones whose free
    // provider reports `status: 0` (live) at the time of writing.
    //
    // When a default below starts 404'ing, replace it via the `ai-features.openrouter.openrouterModels`
    // preference. Any `:free` slug keeps the 🆓 badge automatically (the detector is structural).

    // Verified live on 2026-10-21 (`/api/v1/models/<id>/endpoints`: free provider `status: 0`,
    // `tools` in `supported_parameters`); check again with `node scripts/qaap-openrouter-free-model-health.mjs`.
    // The head is the QAIQ default (Settings with an OpenRouter key and no explicit pick, and
    // `resolveQaiqEnvFallbackModel`); the rest is the same-vendor fallback chain, which only tries the
    // first few entries (`MAX_AGENT_MODEL_FALLBACK_ATTEMPTS`), so the first four come from four
    // different upstream providers: one provider outage cannot take the whole chain down.
    //
    // Removed 2026-10-21: `nvidia/nemotron-3-super-120b-a12b:free` (its only endpoint, Nvidia, went
    // `status: -5` and answers 404 "Function … Not found for account") and `qwen/qwen3.8-27b:free`
    // (no endpoints left). Stored picks of either keep working through the fallback chain.

    // Nvidia — 1M context, largest free Nemotron; best fit for the agent's large system prompt.
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    // Google AI Studio — 262k context, strong general model.
    'google/gemma-4-31b-it:free',
    // Poolside — coding-focused.
    'poolside/laguna-s-2.1:free',
    // Cohere — coding-focused.
    'cohere/north-mini-code:free',
    'google/gemma-4-26b-a4b-it:free',
    'nvidia/nemotron-3.5-lightning:free',
];

export function normalizeOpenRouterModelSlug(raw: string): string {
    const trimmed = raw.trim();
    const prefix = `${OPENROUTER_PROVIDER_ID}/`;
    return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

export function isExcludedOpenRouterModelSlug(raw: string): boolean {
    const trimmed = raw.trim();
    if (!trimmed) {
        return false;
    }
    const slug = normalizeOpenRouterModelSlug(trimmed);
    // `openrouter/elephant-alpha` is a model slug whose org is `openrouter`. Normalizing
    // Theia ids (`openrouter/org/model`) would strip that to `elephant-alpha`, so match both.
    return OPENROUTER_EXCLUDED_MODEL_SLUGS.has(trimmed) || OPENROUTER_EXCLUDED_MODEL_SLUGS.has(slug);
}

/** Drops excluded slugs from preference lists and curated fallbacks. */
export function filterOpenRouterModelSlugs(slugs: readonly string[]): string[] {
    return slugs
        .map(slug => slug.trim())
        .filter(Boolean)
        .filter(slug => !isExcludedOpenRouterModelSlug(slug));
}

/**
 * Returns whether the given language model id refers to a free-tier OpenRouter model. Detection
 * is structural — any model whose slug ends with {@link OPENROUTER_FREE_SUFFIX} qualifies,
 * regardless of whether it is in the curated defaults list. This way user-added free models
 * automatically pick up the "Free" badge.
 *
 * @param languageModelId the fully qualified language model id, e.g. `openrouter/meta-llama/llama-3.3-70b-instruct:free`
 */
export function isFreeOpenRouterModelId(languageModelId: string): boolean {
    const prefix = `${OPENROUTER_PROVIDER_ID}/`;
    if (!languageModelId.startsWith(prefix)) {
        return false;
    }
    const slug = languageModelId.slice(prefix.length);
    if (isExcludedOpenRouterModelSlug(slug)) {
        return false;
    }
    return languageModelId.endsWith(OPENROUTER_FREE_SUFFIX);
}
