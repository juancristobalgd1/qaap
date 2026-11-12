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

/** A Claude model entry the CLI may list: an alias (`opus`, `default`) or a full id, usable as `claude --model <id>`. */
const CLAUDE_MODEL_VALUE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
/** The Claude CLI model families in picker order (the static catalog uses the same order). */
const CLAUDE_MODEL_FAMILIES: readonly string[] = ['fable', 'opus', 'sonnet', 'haiku'];
/** `claude-<family>-<major>[-<minor>]`; the bounded digits keep dated ids such as `claude-haiku-4-5-20251001` out. */
const CLAUDE_BUNDLE_MODEL_ID_PATTERN = /^claude-(fable|opus|sonnet|haiku)-(\d{1,2})(?:-(\d{1,2}))?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses the `control_response` the Claude CLI answers an `initialize` control request with. Only a
 * successful answer whose `response.models` lists well-formed `value`/`displayName` entries is kept, in the
 * CLI's order and without duplicate values; anything else yields `[]`.
 */
export function parseClaudeControlResponseModels(message: unknown): QaapQaiqModelOption[] {
    if (!isRecord(message) || message.type !== 'control_response' || !isRecord(message.response)) {
        return [];
    }
    const answer = message.response;
    if (answer.subtype !== 'success' || !isRecord(answer.response) || !Array.isArray(answer.response.models)) {
        return [];
    }
    const deduped = new Map<string, QaapQaiqModelOption>();
    for (const entry of answer.response.models) {
        if (!isRecord(entry) || typeof entry.value !== 'string' || typeof entry.displayName !== 'string') {
            continue;
        }
        const modelId = entry.value.trim();
        const label = entry.displayName.trim();
        if (!CLAUDE_MODEL_VALUE_PATTERN.test(modelId) || label.length === 0 || label.length > 120) {
            continue;
        }
        if (!deduped.has(modelId)) {
            deduped.set(modelId, { provider: 'anthropic', vendor: 'claude', modelId, label });
        }
    }
    return [...deduped.values()];
}

/**
 * Parses the model ids `grep -aoE` finds in the Claude CLI bundle and keeps the newest version of each
 * family (`fable`, `opus`, `sonnet`, `haiku`). Dated, preview and other suffixed ids are not chat models
 * the picker should offer, so they are dropped. Used only when the CLI cannot answer `initialize`.
 */
export function parseClaudeBundleModelIds(lines: readonly string[]): QaapQaiqModelOption[] {
    const newest = new Map<string, { readonly id: string; readonly major: number; readonly minor: number }>();
    for (const raw of lines) {
        const match = CLAUDE_BUNDLE_MODEL_ID_PATTERN.exec(raw.trim());
        if (!match) {
            continue;
        }
        const [id, family, majorText, minorText] = match;
        const major = Number(majorText);
        const minor = minorText === undefined ? 0 : Number(minorText);
        const current = newest.get(family);
        if (!current || major > current.major || (major === current.major && minor > current.minor)) {
            newest.set(family, { id, major, minor });
        }
    }
    return CLAUDE_MODEL_FAMILIES.flatMap(family => {
        const entry = newest.get(family);
        if (!entry) {
            return [];
        }
        const name = family.charAt(0).toUpperCase() + family.slice(1);
        const version = entry.minor > 0 ? `${entry.major}.${entry.minor}` : `${entry.major}`;
        return [{ provider: 'anthropic', vendor: 'claude', modelId: entry.id, label: `${name} ${version}` }];
    });
}
