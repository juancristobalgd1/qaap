// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { OPENROUTER_DEFAULT_FREE_MODELS } from '@theia/qaap-ai-openrouter/lib/common/openrouter-models';

/** Pi's provider id for OpenRouter, as written in its `--model provider/id` and `auth.json`. */
export const PI_OPENROUTER_PROVIDER_ID = 'openrouter';
/** The model a Pi turn runs when the owner chose none: the head of QAIQ's OpenRouter free default list. */
export const PI_DEFAULT_OPENROUTER_MODEL_ID = OPENROUTER_DEFAULT_FREE_MODELS[0];

export interface PiOwnerDefaultModelInput {
    /** The owner's Pi `settings.json`, when it exists. */
    readonly settingsJson?: string;
    /** The owner's Pi `auth.json`, when it exists. */
    readonly authJson?: string;
    /** `OPENROUTER_API_KEY` is set for the Pi child (Pi reads it without `auth.json`). */
    readonly openRouterKeyInEnv: boolean;
}

function parseJsonObject(text: string | undefined): Record<string, unknown> | undefined {
    if (!text?.trim()) {
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
    } catch {
        return undefined;
    }
}

/** Pi's own precedence: an explicit `--model` beats `settings.json`, so a pinned owner default must be kept. */
function settingsPinsModel(settingsJson: string | undefined): boolean {
    const settings = parseJsonObject(settingsJson);
    return ['defaultModel', 'defaultProvider'].some(key => typeof settings?.[key] === 'string' && (settings[key] as string).trim() !== '');
}

function authHasProvider(authJson: string | undefined, provider: string): boolean {
    return Object.prototype.hasOwnProperty.call(parseJsonObject(authJson) ?? {}, provider);
}

/**
 * The `--model` flag for a Pi turn that names no model: OpenRouter's default free model when the owner's
 * Pi has no pinned default and can reach OpenRouter. Empty otherwise, so Pi keeps its own choice.
 */
export function resolvePiDefaultModelFlag(input: PiOwnerDefaultModelInput): string {
    if (settingsPinsModel(input.settingsJson)) {
        return '';
    }
    if (!input.openRouterKeyInEnv && !authHasProvider(input.authJson, PI_OPENROUTER_PROVIDER_ID)) {
        return '';
    }
    return `--model ${PI_OPENROUTER_PROVIDER_ID}/${PI_DEFAULT_OPENROUTER_MODEL_ID}`;
}
