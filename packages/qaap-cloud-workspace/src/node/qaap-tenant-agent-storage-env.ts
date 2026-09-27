// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';

/**
 * Operator setting for the disk-backed directory that receives package-manager caches and agent
 * data (harness SQLite databases) of processes running inside a tenant container. The value is a
 * path INSIDE the tenant container. `off` (or `0`/`none`/`false`) keeps everything under HOME.
 */
export const QAAP_TENANT_AGENT_STORAGE_ROOT_ENV = 'QAAP_TENANT_AGENT_STORAGE_ROOT';

/**
 * Directory name, relative to the tenant backend's config mount (`/home/theia/.qaap`, a bind mount
 * of the tenant's private, 0700 data root on the host disk). Dot-prefixed so it can never collide
 * with a sanitized GitHub login segment stored beside it.
 */
export const QAAP_TENANT_AGENT_STORAGE_DIRNAME = '.qaap-agent-storage';

/** Cache sub-directory; excluded from VPS backups (fully re-downloadable). */
export const QAAP_TENANT_AGENT_STORAGE_CACHE_DIRNAME = 'cache';

/** Persistent agent data sub-directory (`XDG_DATA_HOME`: opencode.db and similar harness state). */
export const QAAP_TENANT_AGENT_STORAGE_DATA_DIRNAME = 'data';

/**
 * Environment that redirects heavy, non-secret data away from the tenant HOME.
 *
 * Tenant containers run with a read-only root filesystem, so HOME lives on the memory-backed
 * `/tmp` tmpfs. That is fine for small config files, but a pnpm store or a harness database quickly
 * fills the tmpfs (the store alone reached ~490 MB in production and opencode's SQLite then failed
 * with SQLITE_FULL). HOME itself stays on the tmpfs; only these well-known cache/data locations move.
 */
export namespace QaapTenantAgentStorageEnv {

    /** True when the operator explicitly disabled the relocation. */
    export function isDisabled(value: string | undefined): boolean {
        return /^(0|off|none|false|no)$/i.test(value?.trim() ?? '');
    }

    /**
     * Resolve the in-container storage root. An explicit absolute setting wins, an explicit
     * disable returns `undefined`, otherwise `fallbackRoot` (may itself be `undefined`).
     */
    export function resolveRoot(env: NodeJS.ProcessEnv, fallbackRoot: string | undefined): string | undefined {
        const configured = env[QAAP_TENANT_AGENT_STORAGE_ROOT_ENV]?.trim();
        if (configured) {
            if (isDisabled(configured)) {
                return undefined;
            }
            // A relative value would resolve against each child's cwd (the user's repo).
            return path.posix.isAbsolute(configured) ? path.posix.normalize(configured) : undefined;
        }
        return fallbackRoot;
    }

    /** Default root for a backend running inside a tenant container. */
    export function defaultTenantBackendRoot(env: NodeJS.ProcessEnv): string {
        const configRoot = env.QAAP_TENANT_CONFIG_ROOT?.trim() || '/home/theia/.qaap';
        return path.posix.join(configRoot.replace(/\\/g, '/'), QAAP_TENANT_AGENT_STORAGE_DIRNAME);
    }

    /** Cache directory below `root`. */
    export function cacheDir(root: string): string {
        return path.posix.join(root, QAAP_TENANT_AGENT_STORAGE_CACHE_DIRNAME);
    }

    /** Data directory below `root`. */
    export function dataDir(root: string): string {
        return path.posix.join(root, QAAP_TENANT_AGENT_STORAGE_DATA_DIRNAME);
    }

    /** The child-process environment variables for `root`. */
    export function build(root: string): Record<string, string> {
        const cache = cacheDir(root);
        const data = dataDir(root);
        return {
            // Generic XDG caches: yarn v1, pip, corepack, playwright browsers, go build cache…
            XDG_CACHE_HOME: cache,
            // Harness state (opencode.db) and pnpm's default store/global dir live under XDG data.
            XDG_DATA_HOME: data,
            // npm and pnpm read npm_config_* from the environment.
            npm_config_cache: path.posix.join(cache, 'npm'),
            // Keep the pnpm store under cache (not data) so backups can skip it.
            npm_config_store_dir: path.posix.join(cache, 'pnpm-store'),
            // Informational alias for scripts/tools that honour it; pnpm itself uses the line above.
            PNPM_STORE_DIR: path.posix.join(cache, 'pnpm-store'),
            // Bun's global install cache defaults to ~/.bun/install/cache.
            BUN_INSTALL_CACHE_DIR: path.posix.join(cache, 'bun'),
            // Yarn berry's global folder (its global cache lives there); v1 uses XDG_CACHE_HOME.
            // YARN_CACHE_FOLDER is deliberately not set: berry would apply it to projects that
            // commit their own `.yarn/cache` (zero-installs).
            YARN_GLOBAL_FOLDER: path.posix.join(data, 'yarn-berry'),
        };
    }
}
