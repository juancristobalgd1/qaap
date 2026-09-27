// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    resolveUserSettingsFilePath,
    usesSharedAiSettingsFallback,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import {
    QAAP_USER_AGENT_HOOKS_SETTING,
    QAAP_WORKSPACE_HOOKS_RELATIVE_PATH,
    isQaapAgentHookDeclarationEmpty,
    parseQaapAgentHooksConfig,
    type QaapAgentHookDeclaration,
    type QaapAgentHookEventName,
    type QaapAgentHookMatcherGroup,
} from '../common/qaap-agent-hooks';
import { computeQaapAgentHookDigest } from './qaap-agent-hook-trust-store';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';

/** Hard cap on the workspace hooks file; a larger file is reported and ignored. */
const MAX_WORKSPACE_HOOKS_FILE_BYTES = 64 * 1024;
const MAX_ROOT_SEARCH_DEPTH = 40;

export interface QaapLoadedUserHooks {
    readonly declaration: QaapAgentHookDeclaration;
    readonly errors: readonly string[];
}

export interface QaapLoadedWorkspaceHooks {
    /** Canonical repository root (realpath) — the workspace identity used for trust. */
    readonly root: string;
    readonly filePath: string;
    readonly declaration: QaapAgentHookDeclaration;
    /** Present only when the declaration has at least one runnable command. */
    readonly digest?: string;
    readonly errors: readonly string[];
}

/** Loads user-level (settings) and workspace-level (`.qaap/hooks.json`) hook declarations. */
@injectable()
export class QaapAgentHookConfigLoader {

    @inject(QaapTenantSpawnService) @optional()
    protected readonly tenantSpawn: QaapTenantSpawnService | undefined;

    /**
     * User-level hooks: the `qaap.agentHooks` settings key merged with `~/.qaap/hooks.json` in the
     * owner's HOME (the tenant HOME when uid isolation applies). They are the user's own
     * configuration and run without a trust review.
     */
    loadUser(ownerLogin: string | undefined, cwd?: string): QaapLoadedUserHooks {
        const declarations: QaapAgentHookDeclaration[] = [];
        const errors: string[] = [];
        try {
            const raw = this.readUserSettings(ownerLogin)[QAAP_USER_AGENT_HOOKS_SETTING];
            if (raw !== undefined) {
                const parsed = parseQaapAgentHooksConfig(raw);
                declarations.push(parsed.declaration);
                errors.push(...parsed.errors.map(error => `${QAAP_USER_AGENT_HOOKS_SETTING}: ${error}`));
            }
        } catch (error) {
            errors.push(`Could not read user settings: ${this.errorMessage(error)}`);
        }
        const homeFile = this.userHooksFilePath(ownerLogin, cwd);
        if (homeFile) {
            const fromFile = this.readDeclarationFile(homeFile, '~/.qaap/hooks.json');
            if (fromFile) {
                declarations.push(fromFile.declaration);
                errors.push(...fromFile.errors);
            }
        }
        return { declaration: this.merge(declarations), errors };
    }

    /** Concatenates matcher groups per event, preserving source order. */
    protected merge(declarations: readonly QaapAgentHookDeclaration[]): QaapAgentHookDeclaration {
        if (declarations.length <= 1) {
            return declarations[0] ?? {};
        }
        const merged: Partial<Record<QaapAgentHookEventName, QaapAgentHookMatcherGroup[]>> = {};
        for (const declaration of declarations) {
            for (const [event, groups] of Object.entries(declaration) as Array<[QaapAgentHookEventName, readonly QaapAgentHookMatcherGroup[]]>) {
                merged[event] = [...(merged[event] ?? []), ...groups];
            }
        }
        return merged;
    }

    /**
     * `~/.qaap/hooks.json` of the process identity hooks run as: the per-tenant HOME under uid
     * isolation; the backend HOME only for unowned / skip-auth runs, so one tenant never inherits
     * another's (or the operator's) hooks on a shared backend.
     */
    protected userHooksFilePath(ownerLogin: string | undefined, cwd: string | undefined): string | undefined {
        if (cwd && this.tenantSpawn && this.tenantSpawn.resolveSpawnIdentity(cwd).uid !== undefined) {
            return path.join(this.tenantSpawn.resolveTenantHome(cwd), '.qaap', 'hooks.json');
        }
        return usesSharedAiSettingsFallback(ownerLogin) ? path.join(os.homedir(), '.qaap', 'hooks.json') : undefined;
    }

    protected readDeclarationFile(filePath: string, label: string): { declaration: QaapAgentHookDeclaration; errors: string[] } | undefined {
        const stat = this.lstat(filePath);
        if (!stat) {
            return undefined;
        }
        if (!stat.isFile()) {
            return { declaration: {}, errors: [`${label} must be a regular file.`] };
        }
        if (stat.size > MAX_WORKSPACE_HOOKS_FILE_BYTES) {
            return { declaration: {}, errors: [`${label} exceeds ${MAX_WORKSPACE_HOOKS_FILE_BYTES} bytes.`] };
        }
        try {
            const parsed = parseQaapAgentHooksConfig(JSON.parse(fs.readFileSync(filePath, 'utf8')));
            return { declaration: parsed.declaration, errors: parsed.errors.map(error => `${label}: ${error}`) };
        } catch (error) {
            return { declaration: {}, errors: [`${label}: ${this.errorMessage(error)}`] };
        }
    }

    /**
     * Finds `.qaap/hooks.json` from `cwd` upwards, stopping at the first directory with `.git`.
     * Symlinked `.qaap` directories or files are refused: the backend may run as root and must not
     * read (and echo back through the review API) files outside the tenant's repository.
     */
    loadWorkspace(cwd: string): QaapLoadedWorkspaceHooks | undefined {
        const located = this.locateWorkspaceHooksFile(cwd);
        if (!located) {
            return undefined;
        }
        const { root, filePath } = located;
        let text: string;
        try {
            const stat = fs.lstatSync(filePath);
            if (!stat.isFile()) {
                return { root, filePath, declaration: {}, errors: [`${QAAP_WORKSPACE_HOOKS_RELATIVE_PATH} must be a regular file.`] };
            }
            if (stat.size > MAX_WORKSPACE_HOOKS_FILE_BYTES) {
                return { root, filePath, declaration: {}, errors: [`${QAAP_WORKSPACE_HOOKS_RELATIVE_PATH} exceeds ${MAX_WORKSPACE_HOOKS_FILE_BYTES} bytes.`] };
            }
            text = fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            return { root, filePath, declaration: {}, errors: [`Could not read ${QAAP_WORKSPACE_HOOKS_RELATIVE_PATH}: ${this.errorMessage(error)}`] };
        }
        let raw: unknown;
        try {
            raw = JSON.parse(text);
        } catch (error) {
            return { root, filePath, declaration: {}, errors: [`${QAAP_WORKSPACE_HOOKS_RELATIVE_PATH} is not valid JSON: ${this.errorMessage(error)}`] };
        }
        const parsed = parseQaapAgentHooksConfig(raw);
        return {
            root,
            filePath,
            declaration: parsed.declaration,
            errors: parsed.errors,
            ...(isQaapAgentHookDeclarationEmpty(parsed.declaration) ? {} : { digest: computeQaapAgentHookDigest(parsed.declaration) }),
        };
    }

    protected locateWorkspaceHooksFile(cwd: string): { root: string; filePath: string } | undefined {
        let dir = path.resolve(cwd);
        for (let depth = 0; depth < MAX_ROOT_SEARCH_DEPTH; depth++) {
            const qaapDir = path.join(dir, '.qaap');
            const qaapDirStat = this.lstat(qaapDir);
            if (qaapDirStat?.isDirectory()) {
                const filePath = path.join(qaapDir, 'hooks.json');
                const fileStat = this.lstat(filePath);
                if (fileStat && !fileStat.isSymbolicLink()) {
                    return { root: this.canonical(dir), filePath };
                }
            }
            if (this.lstat(path.join(dir, '.git'))) {
                return undefined;
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                return undefined;
            }
            dir = parent;
        }
        return undefined;
    }

    /** Same file selection as the agent runner's settings fallback (per-user file, else shared settings). */
    protected readUserSettings(ownerLogin: string | undefined): Record<string, unknown> {
        const homeDir = os.homedir();
        let settingsPath = path.join(homeDir, '.theia', 'settings.json');
        if (ownerLogin?.trim()) {
            const userSettingsPath = resolveUserSettingsFilePath(ownerLogin, homeDir);
            if (fs.existsSync(userSettingsPath)) {
                settingsPath = userSettingsPath;
            } else if (!usesSharedAiSettingsFallback(ownerLogin)) {
                return {};
            }
        }
        if (!fs.existsSync(settingsPath)) {
            return {};
        }
        const raw = fs.readFileSync(settingsPath, 'utf8');
        const parsed: unknown = raw.trim() ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    }

    protected lstat(target: string): fs.Stats | undefined {
        try {
            return fs.lstatSync(target);
        } catch {
            return undefined;
        }
    }

    protected canonical(dir: string): string {
        try {
            return fs.realpathSync(dir);
        } catch {
            return dir;
        }
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
