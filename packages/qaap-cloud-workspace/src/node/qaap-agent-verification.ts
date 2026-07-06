// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const TYPECHECK_SCRIPT_CANDIDATES = ['typecheck', 'type-check', 'tsc'] as const;
const VERIFICATION_SCRIPT_TAIL = ['build', 'test', 'lint'] as const;

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
