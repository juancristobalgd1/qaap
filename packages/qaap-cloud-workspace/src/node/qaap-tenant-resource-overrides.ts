// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Per-login raises of the tenant container limits, for users who build large projects (e.g. Qaap
 * itself) inside their project:
 * - `QAAP_TENANT_MEMORY_LIMIT_OVERRIDES=alice=8g,bob=6442450944` (bytes or `<n>[k|m|g]`)
 * - `QAAP_TENANT_CPU_LIMIT_OVERRIDES=alice=4`
 * Overrides are capped by `QAAP_TENANT_MEMORY_LIMIT_MAX` (default 16g) and
 * `QAAP_TENANT_CPU_LIMIT_MAX` (default 8), and never lower the global default: the tmpfs size is
 * validated against the default, so a smaller container could be OOM-killed by a full `/tmp`.
 */
export const QAAP_TENANT_MEMORY_LIMIT_OVERRIDES_ENV = 'QAAP_TENANT_MEMORY_LIMIT_OVERRIDES';
export const QAAP_TENANT_CPU_LIMIT_OVERRIDES_ENV = 'QAAP_TENANT_CPU_LIMIT_OVERRIDES';
export const QAAP_TENANT_MEMORY_LIMIT_MAX_ENV = 'QAAP_TENANT_MEMORY_LIMIT_MAX';
export const QAAP_TENANT_CPU_LIMIT_MAX_ENV = 'QAAP_TENANT_CPU_LIMIT_MAX';
const DEFAULT_MEMORY_LIMIT_MAX = 16 * 1024 ** 3;
const DEFAULT_CPU_LIMIT_MAX = 8;

export namespace QaapTenantResourceOverrides {

    /** Container memory in bytes for `login`, given the global default. */
    export function memoryBytes(login: string | undefined, defaultBytes: number, env: NodeJS.ProcessEnv = process.env): number {
        const requested = lookup(env[QAAP_TENANT_MEMORY_LIMIT_OVERRIDES_ENV], login, parseBytes);
        if (requested === undefined) {
            return defaultBytes;
        }
        const max = parseBytes(env[QAAP_TENANT_MEMORY_LIMIT_MAX_ENV] ?? '') ?? DEFAULT_MEMORY_LIMIT_MAX;
        return Math.max(defaultBytes, Math.min(requested, max));
    }

    /** Container CPU in Docker NanoCpus for `login`, given the global default. */
    export function nanoCpus(login: string | undefined, defaultNanoCpus: number, env: NodeJS.ProcessEnv = process.env): number {
        const requested = lookup(env[QAAP_TENANT_CPU_LIMIT_OVERRIDES_ENV], login, parseCores);
        if (requested === undefined) {
            return defaultNanoCpus;
        }
        const max = parseCores(env[QAAP_TENANT_CPU_LIMIT_MAX_ENV] ?? '') ?? DEFAULT_CPU_LIMIT_MAX;
        return Math.max(defaultNanoCpus, Math.floor(Math.min(requested, max) * 1e9));
    }

    function lookup(raw: string | undefined, login: string | undefined, parse: (value: string) => number | undefined): number | undefined {
        const wanted = login?.trim().toLowerCase();
        if (!raw || !wanted) {
            return undefined;
        }
        for (const entry of raw.split(',')) {
            const separator = entry.indexOf('=');
            if (separator > 0 && entry.slice(0, separator).trim().toLowerCase() === wanted) {
                return parse(entry.slice(separator + 1));
            }
        }
        return undefined;
    }

    export function parseBytes(value: string): number | undefined {
        const match = /^(\d+)([kmg]?)$/.exec(value.trim().toLowerCase());
        if (!match) {
            return undefined;
        }
        const bytes = Number.parseInt(match[1], 10) * { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[match[2] as '' | 'k' | 'm' | 'g'];
        return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined;
    }

    function parseCores(value: string): number | undefined {
        const cores = Number(value.trim());
        return value.trim() && Number.isFinite(cores) && cores > 0 ? cores : undefined;
    }
}
