// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapQaiqModelOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { parseNativeModelLines } from './qaap-agent-native-model-catalog';

/**
 * Output parsers for the live model listings of the native agent CLIs. Each parser is strict: it
 * keeps only lines or entries whose shape matches the agent's model id, and drops banners,
 * diagnostics and anything else. A parser that finds nothing returns `[]`, which the discovery
 * layer treats as "no answer" and never as an empty catalog.
 */

const CODEX_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const GROK_LINE_PATTERN = /^\s*\*?\s*(grok-[a-z0-9][a-z0-9._-]*)(\s+\(default\))?\s*$/i;
const AGY_LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9 .()\-]*$/;

/** One row of `codex debug models` / `models_cache.json` as the Codex CLI writes it. */
interface CodexModelEntry {
    readonly slug?: unknown;
    readonly display_name?: unknown;
    readonly visibility?: unknown;
    readonly supported_in_api?: unknown;
}

/**
 * Parses `codex debug models` JSON (also the `models_cache.json` the CLI keeps). Only rows the CLI
 * lists (`visibility: "list"`) and that are usable through the API are kept, in the CLI's order.
 * Banners before the JSON object are skipped; a malformed document yields `[]`.
 */
export function parseCodexDebugModels(text: string | undefined): QaapQaiqModelOption[] {
    if (!text?.trim()) {
        return [];
    }
    const start = text.indexOf('{');
    if (start < 0) {
        return [];
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text.slice(start));
    } catch {
        return [];
    }
    const models = typeof parsed === 'object' && parsed !== null ? (parsed as { models?: unknown }).models : undefined;
    if (!Array.isArray(models)) {
        return [];
    }
    const options = new Map<string, QaapQaiqModelOption>();
    for (const entry of models as CodexModelEntry[]) {
        if (typeof entry !== 'object' || entry === null) {
            continue;
        }
        const slug = typeof entry.slug === 'string' ? entry.slug.trim() : '';
        if (!CODEX_SLUG_PATTERN.test(slug) || entry.visibility !== 'list' || entry.supported_in_api === false) {
            continue;
        }
        const label = typeof entry.display_name === 'string' && entry.display_name.trim() ? entry.display_name.trim() : slug;
        if (!options.has(slug)) {
            options.set(slug, { provider: 'openai', vendor: 'codex', modelId: slug, label });
        }
    }
    return [...options.values()];
}

/**
 * Parses `grok models`: `  * grok-4.7 (default)` rows after the sign-in banner. The default row is
 * moved first so it stays the picker default; the banner and `Default model:` line never match.
 */
export function parseGrokModelLines(lines: readonly string[]): QaapQaiqModelOption[] {
    const defaults: QaapQaiqModelOption[] = [];
    const others: QaapQaiqModelOption[] = [];
    const seen = new Set<string>();
    for (const raw of lines) {
        const match = GROK_LINE_PATTERN.exec(raw);
        if (!match) {
            continue;
        }
        const modelId = match[1];
        const key = modelId.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const option: QaapQaiqModelOption = { provider: 'openai', vendor: 'grok', modelId, label: grokLabel(modelId) };
        (match[2] ? defaults : others).push(option);
    }
    return [...defaults, ...others];
}

function grokLabel(modelId: string): string {
    return modelId.split('-').map(part => (part === 'grok' ? 'Grok' : part)).join(' ');
}

/**
 * Parses `agy models`: `<id><TAB><label>` rows, e.g. `gemini-3.8-flash-high<TAB>Gemini 3.8 Flash (High)`.
 * Antigravity resolves the friendly label verbatim (it is what the `/model` menu stores), so the label
 * is the model id. Rows without a tab, or whose label is not a plain display name, are dropped.
 */
export function parseAgyModelLines(lines: readonly string[]): QaapQaiqModelOption[] {
    const options = new Map<string, QaapQaiqModelOption>();
    for (const raw of lines) {
        const columns = raw.split('\t');
        if (columns.length !== 2) {
            continue;
        }
        const label = columns[1].trim();
        if (!AGY_LABEL_PATTERN.test(label) || !/^[a-z][a-z0-9._-]*$/i.test(columns[0].trim())) {
            continue;
        }
        const key = label.toLowerCase();
        if (!options.has(key)) {
            options.set(key, { provider: agyProvider(label), vendor: 'antigravity', modelId: label, label });
        }
    }
    return [...options.values()];
}

function agyProvider(label: string): QaapQaiqModelOption['provider'] {
    if (/^gemini/i.test(label)) {
        return 'gemini';
    }
    if (/^claude/i.test(label)) {
        return 'anthropic';
    }
    return 'openai';
}

/**
 * Parses a CLI's stdout into picker entries for `agentId`. Line-oriented agents go through
 * {@link parseNativeModelLines}; the others have their own strict shape. Unknown agents yield `[]`.
 */
export function parseNativeModelOutput(agentId: string, stdout: string): QaapQaiqModelOption[] {
    const normalized = agentId.trim().toLowerCase();
    const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    switch (normalized) {
        case 'codex':
            return parseCodexDebugModels(stdout);
        case 'grok':
            return parseGrokModelLines(stdout.split(/\r?\n/));
        case 'antigravity':
        case 'gemini':
            return parseAgyModelLines(stdout.split(/\r?\n/));
        case 'opencode':
        case 'pi':
        case 'cursor':
            return parseNativeModelLines(normalized, lines);
        default:
            return [];
    }
}
