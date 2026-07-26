// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const TYPECHECK_SCRIPT_CANDIDATES = ['typecheck', 'type-check', 'tsc'] as const;
const VERIFICATION_SCRIPT_TAIL = ['build', 'test', 'lint'] as const;

/**
 * npm script names only. A goal's success check is chosen by the caller over HTTP, so it must never
 * be able to become a command: this is checked against the repository's OWN `scripts`, and the
 * runner still invokes it as `npm run <name>` through `execFile`, never through a shell.
 */
const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$/;

/**
 * The caller's chosen check, if the repository actually declares it. Returns undefined for an
 * unknown or malformed name so the caller falls back to the repository's own verification scripts
 * rather than "verifying" nothing at all.
 */
export function resolveQaapDeclaredVerificationScript(packageJson: unknown, script: string | undefined): string | undefined {
    if (!script || !SCRIPT_NAME.test(script)) {
        return undefined;
    }
    const scripts = (packageJson as { scripts?: unknown } | undefined)?.scripts;
    if (!scripts || typeof scripts !== 'object') {
        return undefined;
    }
    return typeof (scripts as Record<string, unknown>)[script] === 'string' ? script : undefined;
}

/** Whether a name is even shaped like an npm script, for validating a request before it is stored. */
export function isQaapVerificationScriptName(script: string): boolean {
    return SCRIPT_NAME.test(script);
}

export function resolveQaapAgentVerificationScripts(packageJson: unknown): string[] {
    if (!packageJson || typeof packageJson !== 'object') {
        return [];
    }
    const scripts = (packageJson as { scripts?: unknown }).scripts;
    if (!scripts || typeof scripts !== 'object') {
        return [];
    }
    const record = scripts as Record<string, unknown>;
    const result: string[] = [];
    const typecheck = TYPECHECK_SCRIPT_CANDIDATES.find(name => typeof record[name] === 'string');
    if (typecheck) {
        result.push(typecheck);
    }
    for (const name of VERIFICATION_SCRIPT_TAIL) {
        if (typeof record[name] === 'string') {
            result.push(name);
        }
    }
    return result;
}
