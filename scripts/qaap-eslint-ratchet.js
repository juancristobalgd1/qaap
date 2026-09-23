// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Lint ratchet for `packages/qaap-*`.
 *
 * Qaap packages extend the upstream `configs/build.eslintrc.json` like every Theia package. Rules
 * with a large existing backlog (September 2026: ~5.8k findings, mostly `ctx: any` in extracted
 * `*Extracted()` modules) are downgraded to warnings so CI stays green while they are paid down.
 *
 * To tighten: fix a rule's warnings in all qaap packages, then delete its line below so it becomes
 * an error again. Never add a rule here to silence new code.
 *
 * A severity-only override keeps the upstream rule options (e.g. `max-len` code: 180).
 */
const QAAP_WARN_BACKLOG = [
    '@typescript-eslint/no-explicit-any',
    '@typescript-eslint/tslint/config',
    'no-void',
    'no-null/no-null',
    'max-len',
    '@theia/localization-check',
    '@typescript-eslint/no-shadow',
    'no-duplicate-imports',
    '@theia/shared-dependencies',
    'import/no-extraneous-dependencies',
    '@typescript-eslint/consistent-type-definitions',
    '@theia/runtime-import-check',
    '@theia/no-src-import',
    'no-unused-expressions',
];

module.exports = {
    rules: {
        ...Object.fromEntries(QAAP_WARN_BACKLOG.map(rule => [rule, 'warn'])),
        // Same as upstream, but allow the `let timer; const done = () => clearTimeout(timer); timer = …`
        // pattern (read in a closure before its single assignment), which cannot be a `const`.
        'prefer-const': ['error', { destructuring: 'all', ignoreReadBeforeAssign: true }],
        // Qaap-specific guard: an assignment in an argument position overwrites the caller's value
        // (`fooExtracted(this, limit = 8)`); the *Extracted refactor shipped seven such bugs.
        'no-restricted-syntax': ['error',
            {
                selector: 'CallExpression > AssignmentExpression.arguments',
                message: 'Assignment used as a call argument overwrites the value; pass the variable (or the expression) instead.'
            },
            {
                selector: 'NewExpression > AssignmentExpression.arguments',
                message: 'Assignment used as a constructor argument overwrites the value; pass the variable (or the expression) instead.'
            }
        ],
    }
};
