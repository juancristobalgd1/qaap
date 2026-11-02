// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { OPENROUTER_DEFAULT_FREE_MODELS } from '@theia/qaap-ai-openrouter/lib/common/openrouter-models';

/** Pi's provider id for OpenRouter, as written in its `--model provider/id` and `auth.json`. */
export const PI_OPENROUTER_PROVIDER_ID = 'openrouter';
/** The model a Pi turn runs when the owner chose none: the head of QAIQ's OpenRouter free default list. */
export const PI_DEFAULT_OPENROUTER_MODEL_ID = OPENROUTER_DEFAULT_FREE_MODELS[0];

/**
 * A POSIX shell substitution for the `{model_flags}` of a Pi turn without a chosen model. It runs INSIDE
 * the Pi child's command, so it reads the Pi agent directory of the HOME that child really uses (the task
 * sandbox's `/tmp/qaap-home`, a tenant HOME, or the backend's own HOME), never the backend's HOME.
 *
 * It prints `--model openrouter/<head of the free default list>` unless either
 * - the agent directory's `settings.json` pins a `defaultModel` or `defaultProvider` (Pi's own
 *   precedence puts `--model` above settings, so adding it would override the owner's pin), or
 * - the child cannot reach OpenRouter (no `OPENROUTER_API_KEY` and no `openrouter` entry in `auth.json`).
 */
export function buildPiDefaultModelFlagShell(): string {
    const model = `${PI_OPENROUTER_PROVIDER_ID}/${PI_DEFAULT_OPENROUTER_MODEL_ID}`;
    const pinned = '\'"(defaultModel|defaultProvider)"[[:space:]]*:[[:space:]]*"[^"]\'';
    const noOpenRouter = '[ -z "$OPENROUTER_API_KEY" ] && ! grep -qs \'"openrouter"[[:space:]]*:\' "$d/auth.json"';
    return `$(d="\${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"; if grep -qsE ${pinned} "$d/settings.json" || { ${noOpenRouter}; }; then :; else printf '%s' '--model ${model}'; fi)`;
}
