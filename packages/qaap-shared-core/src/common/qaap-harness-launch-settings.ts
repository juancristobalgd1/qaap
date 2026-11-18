// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Per-harness settings from Settings → Harness (the gear next to each switch) and the extra harness
 * instances added with "Add harness".
 *
 * Both live in the user's preferences next to `ai-features.harness.disabledAgents`, so the backend task
 * runner reads them with the same owner-scoped preference reader. The display name is applied everywhere;
 * the binary path and the configuration folder are honoured only by a desktop backend
 * (`qaap-harness-launch-overrides.ts` in qaap-cloud-workspace) and ignored by every web, VPS or tenant
 * backend even when they are present in the preferences.
 */

/** Map of harness (or instance) id → {@link QaapHarnessLaunchSettings}. */
export const QAAP_HARNESS_SETTINGS_PREF = 'ai-features.harness.settings';

/** Ordered list of {@link QaapHarnessInstance} added with "Add harness". */
export const QAAP_HARNESS_INSTANCES_PREF = 'ai-features.harness.instances';

export const QAAP_HARNESS_LABEL_MAX_LENGTH = 64;
export const QAAP_HARNESS_PATH_MAX_LENGTH = 1024;
/** Instances per base harness (`codex#2` … `codex#9`). */
export const QAAP_HARNESS_MAX_INSTANCES_PER_BASE = 8;

export interface QaapHarnessLaunchSettings {
    /** Name shown in Settings and in the composer picker. */
    readonly label?: string;
    /** Absolute path of the harness executable (desktop only). */
    readonly binaryPath?: string;
    /** Absolute path of the harness configuration folder, e.g. `CODEX_HOME` (desktop only). */
    readonly homeDir?: string;
    /**
     * Names of the environment variables set for this harness (desktop only). Only the names live in the
     * preferences; every value is a secret kept by the backend (`QaapHarnessEnvSecretStore`).
     */
    readonly envNames?: readonly string[];
}

export interface QaapHarnessInstance {
    /** Stable id derived from the base harness: `<baseId>#<n>`. */
    readonly id: string;
    /** Built-in harness this instance launches (`codex`, `claude`, …). */
    readonly baseId: string;
}

/**
 * Environment variable that points a harness CLI at another configuration folder. Only harnesses whose
 * CLI documents such a variable are listed; the others do not offer the field.
 * - Codex reads `CODEX_HOME` (the tool-gate overlay copies its `auth.json` from there).
 * - Claude Code reads `CLAUDE_CONFIG_DIR`.
 */
export const QAAP_HARNESS_HOME_ENV_VARS: Readonly<Record<string, string>> = {
    codex: 'CODEX_HOME',
    claude: 'CLAUDE_CONFIG_DIR',
};

export function resolveQaapHarnessHomeEnvVar(baseId: string): string | undefined {
    return QAAP_HARNESS_HOME_ENV_VARS[baseId.trim().toLowerCase()];
}

const INSTANCE_ID_PATTERN = /^([a-z0-9][a-z0-9-]*)#([2-9])$/;

/** Base harness of `codex#2` (`codex`), or the id itself for a built-in harness. */
export function resolveQaapHarnessBaseId(harnessId: string): string {
    const normalized = harnessId.trim().toLowerCase();
    const match = INSTANCE_ID_PATTERN.exec(normalized);
    return match ? match[1] : normalized;
}

export function isQaapHarnessInstanceId(harnessId: string): boolean {
    return INSTANCE_ID_PATTERN.test(harnessId.trim().toLowerCase());
}

function readTrimmedString(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

export function readQaapHarnessLaunchSettings(value: unknown): QaapHarnessLaunchSettings {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const record = value as Record<string, unknown>;
    const label = readTrimmedString(record.label, QAAP_HARNESS_LABEL_MAX_LENGTH);
    const binaryPath = readTrimmedString(record.binaryPath, QAAP_HARNESS_PATH_MAX_LENGTH);
    const homeDir = readTrimmedString(record.homeDir, QAAP_HARNESS_PATH_MAX_LENGTH);
    const envNames = readQaapHarnessEnvNames(record.envNames);
    return {
        ...(label ? { label } : {}),
        ...(binaryPath ? { binaryPath } : {}),
        ...(homeDir ? { homeDir } : {}),
        ...(envNames.length > 0 ? { envNames } : {}),
    };
}

function isEmptySettings(settings: QaapHarnessLaunchSettings): boolean {
    return !settings.label && !settings.binaryPath && !settings.homeDir && !settings.envNames?.length;
}

/** Normalized settings map: lower-case ids, unknown fields and empty entries dropped. */
export function readQaapHarnessSettingsMap(value: unknown): Record<string, QaapHarnessLaunchSettings> {
    const result: Record<string, QaapHarnessLaunchSettings> = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return result;
    }
    for (const [rawId, rawSettings] of Object.entries(value as Record<string, unknown>)) {
        const id = rawId.trim().toLowerCase();
        const settings = readQaapHarnessLaunchSettings(rawSettings);
        if (id && !isEmptySettings(settings)) {
            result[id] = settings;
        }
    }
    return result;
}

export function readQaapHarnessSettingsFor(value: unknown, harnessId: string): QaapHarnessLaunchSettings {
    return readQaapHarnessSettingsMap(value)[harnessId.trim().toLowerCase()] ?? {};
}

/** The map with `harnessId` replaced; `undefined` or empty settings restore the defaults (entry removed). */
export function withQaapHarnessSettings(
    value: unknown,
    harnessId: string,
    settings: QaapHarnessLaunchSettings | undefined,
): Record<string, QaapHarnessLaunchSettings> {
    const id = harnessId.trim().toLowerCase();
    const map = { ...readQaapHarnessSettingsMap(value) };
    const normalized = readQaapHarnessLaunchSettings(settings);
    if (isEmptySettings(normalized)) {
        delete map[id];
    } else {
        map[id] = normalized;
    }
    return map;
}

/** Valid instances only: well-formed `<base>#<n>` id whose base is one of `knownBaseIds`, no duplicates. */
export function readQaapHarnessInstances(value: unknown, knownBaseIds: Iterable<string>): QaapHarnessInstance[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const known = new Set(Array.from(knownBaseIds, id => id.trim().toLowerCase()));
    const seen = new Set<string>();
    const result: QaapHarnessInstance[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const id = typeof (entry as QaapHarnessInstance).id === 'string' ? (entry as QaapHarnessInstance).id.trim().toLowerCase() : '';
        const match = INSTANCE_ID_PATTERN.exec(id);
        if (!match || !known.has(match[1]) || seen.has(id)) {
            continue;
        }
        const baseId = typeof (entry as QaapHarnessInstance).baseId === 'string' ? (entry as QaapHarnessInstance).baseId.trim().toLowerCase() : '';
        if (baseId && baseId !== match[1]) {
            continue;
        }
        seen.add(id);
        result.push({ id, baseId: match[1] });
    }
    return result;
}

/** Next free `<baseId>#<n>` (n = 2…9), or `undefined` when the base already has the maximum. */
export function nextQaapHarnessInstanceId(baseId: string, instances: readonly QaapHarnessInstance[]): string | undefined {
    const base = baseId.trim().toLowerCase();
    const taken = new Set(instances.map(instance => instance.id));
    for (let n = 2; n < 2 + QAAP_HARNESS_MAX_INSTANCES_PER_BASE; n++) {
        const id = `${base}#${n}`;
        if (!taken.has(id)) {
            return id;
        }
    }
    return undefined;
}

export type QaapHarnessPathShapeIssue = 'not-absolute' | 'unsafe-characters' | 'too-long';

/**
 * Static check shared by the settings panel and the backend: an absolute path made of plain characters.
 * Shell metacharacters, quotes, control characters and `..` segments are refused outright (the backend
 * still quotes the path; this is defence in depth). A Windows drive path (`C:\…`) may use backslashes.
 */
export function checkQaapHarnessPathShape(value: string): QaapHarnessPathShapeIssue | undefined {
    if (value.length > QAAP_HARNESS_PATH_MAX_LENGTH) {
        return 'too-long';
    }
    const windowsDrive = /^[A-Za-z]:[\\/]/.test(value);
    if (!value.startsWith('/') && !windowsDrive) {
        return 'not-absolute';
    }
    const body = windowsDrive ? value.slice(2) : value;
    // `~` is literal inside the quoted path (Windows 8.3 names such as `RUNNER~1`); parentheses only in a
    // drive path, for `Program Files (x86)`, where the quoted cmd argument keeps them literal.
    const unsafe = windowsDrive ? /[\u0000-\u001f\u007f'"`$;|&<>*?!{}[\]^%=#]/ : /[\u0000-\u001f\u007f'"`$;|&<>*?!{}()[\]^%=#]/;
    if (unsafe.test(body) || (!windowsDrive && body.includes('\\'))) {
        return 'unsafe-characters';
    }
    if (body.split(/[\\/]/).some(segment => segment === '..')) {
        return 'unsafe-characters';
    }
    return undefined;
}

/** `Codex 2` for `codex#2`: the name an instance shows until the user renames it. */
export function defaultQaapHarnessInstanceLabel(baseLabel: string, instanceId: string): string {
    const match = INSTANCE_ID_PATTERN.exec(instanceId.trim().toLowerCase());
    return match ? `${baseLabel} ${match[2]}` : baseLabel;
}

/** Display name of a harness or instance: the user's name from Settings, else the default. */
export function resolveQaapHarnessDisplayLabel(settingsValue: unknown, harnessId: string, baseLabel: string): string {
    const custom = readQaapHarnessSettingsFor(settingsValue, harnessId).label;
    if (custom) {
        return custom;
    }
    return isQaapHarnessInstanceId(harnessId) ? defaultQaapHarnessInstanceLabel(baseLabel, harnessId) : baseLabel;
}

export const QAAP_HARNESS_ENV_MAX_VARIABLES = 32;
export const QAAP_HARNESS_ENV_VALUE_MAX_LENGTH = 8192;
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]{0,127}$/;

/**
 * Variables a harness environment may never set: the process basics, loader and interpreter hooks,
 * credentials Qaap manages itself, and every variable the runner, the Tool Gate, the task sandbox or the
 * configuration folder assigns. The runner also wins over a user value at spawn time; refusing them up
 * front gives a clear message instead of a silently ignored row.
 */
const DENIED_ENV_NAMES = new Set([
    'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'PWD', 'USERPROFILE',
    'NODE_OPTIONS', 'NODE_PATH', 'NODE_ENV', 'BASH_ENV', 'ENV', 'PROMPT_COMMAND', 'IFS',
    'PYTHONPATH', 'PYTHONSTARTUP', 'RUBYOPT', 'PERL5OPT', 'GITHUB_TOKEN', 'PORT',
    // Assigned by the runner, the Tool Gate, the task sandbox or the configuration folder.
    'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_SHELL', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    'IS_SANDBOX', 'OPENCLAUDE_MAX_RETRIES', 'OPENCODE_PERMISSION', 'OPENCODE_CONFIG_CONTENT',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
]);
const DENIED_ENV_PREFIXES = ['ELECTRON_', 'LD_', 'DYLD_', 'GIT_', 'SSH_', 'GH_', 'QAAP_', 'THEIA_', 'XDG_'];

export type QaapHarnessEnvNameIssue = 'invalid' | 'denied';

/** `undefined` for a name a harness environment may set. */
export function checkQaapHarnessEnvName(name: string): QaapHarnessEnvNameIssue | undefined {
    if (!ENV_NAME_PATTERN.test(name)) {
        return 'invalid';
    }
    if (DENIED_ENV_NAMES.has(name) || DENIED_ENV_PREFIXES.some(prefix => name.startsWith(prefix))) {
        return 'denied';
    }
    return undefined;
}

/** Valid, allowed, unique names, at most {@link QAAP_HARNESS_ENV_MAX_VARIABLES}. */
export function readQaapHarnessEnvNames(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const names: string[] = [];
    for (const entry of value) {
        if (typeof entry === 'string' && !checkQaapHarnessEnvName(entry) && !names.includes(entry)) {
            names.push(entry);
        }
    }
    return names.slice(0, QAAP_HARNESS_ENV_MAX_VARIABLES);
}

/** Built-in harness or instance id a settings entry may be keyed by (`codex`, `codex#2`). */
export function isQaapHarnessSettingsId(harnessId: string, knownBaseIds: Iterable<string>): boolean {
    const normalized = harnessId.trim().toLowerCase();
    const known = new Set(Array.from(knownBaseIds, id => id.trim().toLowerCase()));
    return known.has(normalized) || (isQaapHarnessInstanceId(normalized) && known.has(resolveQaapHarnessBaseId(normalized)));
}
