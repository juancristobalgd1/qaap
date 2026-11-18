// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import { isQaapDesktopRuntime } from '@theia/qaap-adapters/lib/common/qaap-desktop-runtime';
import { isQaapHostedEnvironment } from '@theia/qaap-adapters/lib/common/qaap-hosted-runtime';
import { isQaapTenantBackendMode } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { QAAP_BUILTIN_AGENT_IDS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import {
    checkQaapHarnessPathShape,
    isQaapHarnessInstanceId,
    QAAP_HARNESS_INSTANCES_PREF,
    QAAP_HARNESS_SETTINGS_PREF,
    readQaapHarnessInstances,
    readQaapHarnessSettingsFor,
    resolveQaapHarnessBaseId,
    resolveQaapHarnessHomeEnvVar,
    type QaapHarnessInstance,
    type QaapHarnessPathShapeIssue,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-launch-settings';
import {
    isQaapHarnessEnabled,
    QAAP_DISABLED_HARNESSES_PREF,
    readDisabledHarnessIds,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-preferences';
import { readQaapTenantOwnerLogin } from '@theia/qaap-shared-core/lib/common/qaap-secret-placeholder';

type PreferenceReader = (key: string) => unknown;

/**
 * Whether this backend honours a harness binary path or configuration folder from Settings → Harness.
 * Same criterion as the GitHub MCP credential resolver's `desktop` mode: the local desktop app only
 * (`QAAP_DESKTOP=1`), never a tenant backend, a hosted backend or a backend whose runtime is not stated.
 * Everywhere else the two fields are ignored even when they are present in the user's preferences, so a
 * web user can never make the server run an arbitrary executable or read another configuration folder.
 */
export function isQaapHarnessLaunchOverrideRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
    if (readQaapTenantOwnerLogin(env) || isQaapTenantBackendMode(env) || isQaapHostedEnvironment(env)) {
        return false;
    }
    return isQaapDesktopRuntime(env);
}

export type QaapHarnessPathIssue = QaapHarnessPathShapeIssue | 'missing' | 'not-a-file' | 'not-executable' | 'not-a-directory';

/** Absolute path of an existing executable file. The path is only ever passed quoted to the spawn, never expanded. */
export function checkQaapHarnessBinaryPath(value: string, platform: NodeJS.Platform = process.platform): QaapHarnessPathIssue | undefined {
    const shape = checkQaapHarnessPathShape(value);
    if (shape) {
        return shape;
    }
    let stat: fs.Stats;
    try {
        stat = fs.statSync(value);
    } catch {
        return 'missing';
    }
    if (!stat.isFile()) {
        return 'not-a-file';
    }
    if (platform !== 'win32') {
        try {
            fs.accessSync(value, fs.constants.X_OK);
        } catch {
            return 'not-executable';
        }
    }
    return undefined;
}

/** Absolute path of an existing directory. */
export function checkQaapHarnessHomeDir(value: string): QaapHarnessPathIssue | undefined {
    const shape = checkQaapHarnessPathShape(value);
    if (shape) {
        return shape;
    }
    try {
        return fs.statSync(value).isDirectory() ? undefined : 'not-a-directory';
    } catch {
        return 'missing';
    }
}

export function describeQaapHarnessPathIssue(issue: QaapHarnessPathIssue): string {
    switch (issue) {
        case 'not-absolute': return 'the path must be absolute';
        case 'unsafe-characters': return 'the path contains characters that are not allowed';
        case 'too-long': return 'the path is too long';
        case 'missing': return 'nothing exists at this path';
        case 'not-a-file': return 'the path is not a file';
        case 'not-executable': return 'the file is not executable';
        case 'not-a-directory': return 'the path is not a folder';
    }
}

/** A harness override from Settings that cannot be applied: the turn fails instead of using another binary or account. */
export class QaapHarnessLaunchOverrideError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'QaapHarnessLaunchOverrideError';
    }
}

/** What a spawn changes for one harness (or harness instance). Empty outside the desktop app. */
export interface QaapHarnessLaunchPlan {
    readonly binaryPath?: string;
    readonly homeEnvVar?: string;
    readonly homeDir?: string;
}

export interface QaapHarnessLaunchPlanOptions {
    readonly env?: NodeJS.ProcessEnv;
    readonly checkBinary?: (value: string) => QaapHarnessPathIssue | undefined;
    readonly checkHome?: (value: string) => QaapHarnessPathIssue | undefined;
}

/**
 * The binary/home overrides for `harnessKey` (a built-in id such as `codex` or an instance id such as
 * `codex#2`). Outside the desktop app the result is always empty. On the desktop an override that does not
 * validate throws {@link QaapHarnessLaunchOverrideError}: running the default binary or the default account
 * instead of the one the user chose would be a silent wrong-account run.
 */
export function resolveQaapHarnessLaunchPlan(
    harnessKey: string,
    readPref: PreferenceReader,
    options: QaapHarnessLaunchPlanOptions = {},
): QaapHarnessLaunchPlan {
    if (!isQaapHarnessLaunchOverrideRuntime(options.env ?? process.env)) {
        return {};
    }
    const settings = readQaapHarnessSettingsFor(readPref(QAAP_HARNESS_SETTINGS_PREF), harnessKey);
    const baseId = resolveQaapHarnessBaseId(harnessKey);
    let binaryPath: string | undefined;
    if (settings.binaryPath) {
        const issue = (options.checkBinary ?? checkQaapHarnessBinaryPath)(settings.binaryPath);
        if (issue) {
            throw new QaapHarnessLaunchOverrideError(
                `The binary path set for this harness in Settings → Harness cannot be used: ${describeQaapHarnessPathIssue(issue)} (${settings.binaryPath}).`,
            );
        }
        binaryPath = settings.binaryPath;
    }
    const homeEnvVar = resolveQaapHarnessHomeEnvVar(baseId);
    let homeDir: string | undefined;
    if (settings.homeDir && homeEnvVar) {
        const issue = (options.checkHome ?? checkQaapHarnessHomeDir)(settings.homeDir);
        if (issue) {
            throw new QaapHarnessLaunchOverrideError(
                `The configuration folder set for this harness in Settings → Harness cannot be used: ${describeQaapHarnessPathIssue(issue)} (${settings.homeDir}).`,
            );
        }
        homeDir = settings.homeDir;
    }
    return {
        ...(binaryPath ? { binaryPath } : {}),
        ...(homeDir && homeEnvVar ? { homeEnvVar, homeDir } : {}),
    };
}

/**
 * Replaces the leading executable of a built harness command (`codex exec …`) with the quoted override.
 * Only the first token changes; the flags the runner built (gate, approval, model) stay as they are. A
 * command that does not start with the harness executable fails closed rather than ignoring the override.
 */
export function applyQaapHarnessBinaryOverride(
    command: string,
    defaultBin: string,
    binaryPath: string | undefined,
    quote: (value: string) => string,
): string {
    if (!binaryPath) {
        return command;
    }
    const trimmed = command.replace(/^\s+/, '');
    if (trimmed === defaultBin || trimmed.startsWith(`${defaultBin} `)) {
        return `${quote(binaryPath)}${trimmed.slice(defaultBin.length)}`;
    }
    throw new QaapHarnessLaunchOverrideError(
        'The binary path set for this harness in Settings → Harness cannot be applied to its launch command.',
    );
}

export interface QaapHarnessInstanceRoute {
    readonly instanceId: string;
    readonly baseId: string;
    /** False when the instance is not in the owner's instance list (deleted, or never added). */
    readonly configured: boolean;
    readonly enabled: boolean;
}

/** Configured harness instances of the owner (`ai-features.harness.instances`). */
export function readQaapOwnerHarnessInstances(readPref: PreferenceReader): QaapHarnessInstance[] {
    return readQaapHarnessInstances(readPref(QAAP_HARNESS_INSTANCES_PREF), QAAP_BUILTIN_AGENT_IDS);
}

/** Route for a requested agent id that names a harness instance (`codex#2`), or `undefined` for any other id. */
export function resolveQaapHarnessInstanceRoute(requested: string | undefined, readPref: PreferenceReader): QaapHarnessInstanceRoute | undefined {
    const normalized = requested?.trim().replace(/^@/, '').toLowerCase();
    if (!normalized || !isQaapHarnessInstanceId(normalized)) {
        return undefined;
    }
    const baseId = resolveQaapHarnessBaseId(normalized);
    const configured = readQaapOwnerHarnessInstances(readPref).some(instance => instance.id === normalized);
    const enabled = configured && isQaapHarnessEnabled(normalized, readDisabledHarnessIds(readPref(QAAP_DISABLED_HARNESSES_PREF)));
    return { instanceId: normalized, baseId, configured, enabled };
}
