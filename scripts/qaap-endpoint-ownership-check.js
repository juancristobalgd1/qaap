#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Ratchet for unguarded HTTP endpoints in `packages/qaap-*`.
 *
 * Qaap runs a multi-tenant layer on top of single-tenant Theia (see
 * MULTI_TENANCY_AUDIT.md): isolation depends on every authenticated endpoint resolving the
 * caller's identity and proving it owns the workspace path it touches. Nothing in the type
 * system enforces that, so before this guard the only barrier was code review.
 *
 * Every route registered on an `app` / `router` / `server` object in the Node sources of
 * packages whose name starts with `qaap-` is classified as:
 *
 * - `guarded`: the registration (including inline middleware) or the resolved handler body
 *   references an ownership/auth primitive (`this.auth.*`, `requireAuth`, `ownerLogin`,
 *   `assertWorkspacePathOwned`, `ownsWorkspacePath`, ...).
 * - `unguarded`: none of those appear. Either it is intentionally public (health, OAuth
 *   callback before login, signature-verified webhooks) and belongs in the baseline with a
 *   reason, or it is a real isolation gap.
 *
 * The allowed set is the list in scripts/qaap-endpoint-ownership-baseline.txt and may only
 * shrink, exactly like scripts/qaap-ts-nocheck-baseline.txt:
 *
 * - a guarded route may NOT be added to the baseline (only `--allow-growth` by hand);
 * - a baseline entry whose route is now guarded, or no longer exists, also fails, so the
 *   list tightens as gaps are closed.
 *
 * A route mounted behind an `app.use('/prefix', guard)` earlier in the file, or guarded by a
 * helper this stat  is not a false pass: it lands in the baseline with a written reason.
 *
 * Usage:
 *   node scripts/qaap-endpoint-ownership-check.js            # gate (exit 1 on new/stale)
 *   node scripts/qaap-endpoint-ownership-check.js --report   # full table, always exit 0
 *   node scripts/qaap-endpoint-ownership-check.js --write    # rewrite the baseline
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'qaap-endpoint-ownership-baseline.txt');

/** Route-registering methods. `use` is deliberately excluded: `app.use(json())` is middleware, not a route. */
const ROUTE_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'];

/** Receivers that register routes in this codebase. */
const RECEIVER = /(^|\.)(app|router|server|httpServer|expressApp)$/i;

/**
 * Auth/ownership primitives. A route is `guarded` when any of these appears in the
 * registration call, in an inline handler, or in the body of the handler it delegates to.
 */
const GUARD_TOKENS = [
    'this.auth.',
    'this.requireAuth',
    'this.requireLogin',
    'this.requireHttpAuth',
    'requireHttpAuth',
    'assertWorkspacePathOwned',
    'ownsWorkspacePath',
    'loginOwnsWorkspacePath',
    'resolveOwnedRepositoryCwd',
    'denyForbidden',
    'requireAuth',
    'requireLogin',
    'ownerLogin',
    'resolveUserLogin',
    'pathBelongsToUser',
    'IfOwned',
];

// ---------------------------------------------------------------------------------------
// Source scanning helpers
// ---------------------------------------------------------------------------------------

/** Skip a quoted string starting at `i` (which points at the opening quote); return the index after it. */
function skipString(src, i) {
    const quote = src[i];
    i++;
    while (i < src.length) {
        if (src[i] === '\\') {
            i += 2;
            continue;
        }
        if (src[i] === quote) {
            return i + 1;
        }
        if (src[i] === '\n') {
            // Unterminated string: stop at the newline rather than swallowing the file.
            return i + 1;
        }
        i++;
    }
    return i;
}

/** Skip a template literal starting at the backtick; handles nested `${ ... }` including nested templates. */
function skipTemplate(src, i) {
    i++;
    while (i < src.length) {
        if (src[i] === '\\') {
            i += 2;
            continue;
        }
        if (src[i] === '`') {
            return i + 1;
        }
        if (src[i] === '$' && src[i + 1] === '{') {
            const end = scanBalanced(src, i + 1, '{', '}');
            i = end < 0 ? src.length : end;
            continue;
        }
        i++;
    }
    return i;
}

/**
 * From the delimiter at `openIdx`, return the index just past its matching close.
 * Strings, template literals and comments are skipped so delimiters inside them do not count.
 */
function scanBalanced(src, openIdx, open, close) {
    let depth = 0;
    let i = openIdx;
    while (i < src.length) {
        const ch = src[i];
        const next = src[i + 1];
        if (ch === '/' && next === '/') {
            const nl = src.indexOf('\n', i);
            i = nl < 0 ? src.length : nl;
            continue;
        }
        if (ch === '/' && next === '*') {
            const end = src.indexOf('*/', i + 2);
            i = end < 0 ? src.length : end + 2;
            continue;
        }
        if (ch === "'" || ch === '"') {
            i = skipString(src, i);
            continue;
        }
        if (ch === '`') {
            i = skipTemplate(src, i);
            continue;
        }
        if (ch === open) {
            depth++;
            i++;
            continue;
        }
        if (ch === close) {
            depth--;
            i++;
            if (depth === 0) {
                return i;
            }
            continue;
        }
        i++;
    }
    return -1;
}

/** Remove comments so a token inside a comment cannot count as a guard. */
function stripComments(src) {
    let out = '';
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        const next = src[i + 1];
        if (ch === '/' && next === '/') {
            const nl = src.indexOf('\n', i);
            i = nl < 0 ? src.length : nl;
            continue;
        }
        if (ch === '/' && next === '*') {
            const end = src.indexOf('*/', i + 2);
            i = end < 0 ? src.length : end + 2;
            continue;
        }
        if (ch === "'" || ch === '"') {
            const end = skipString(src, i);
            out += src.slice(i, end);
            i = end;
            continue;
        }
        if (ch === '`') {
            const end = skipTemplate(src, i);
            out += src.slice(i, end);
            i = end;
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}

/** Split an argument list (the text between the parens) on top-level commas. */
function splitTopLevelArgs(src) {
    const args = [];
    let depth = 0;
    let start = 0;
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        const next = src[i + 1];
        if (ch === '/' && next === '/') {
            const nl = src.indexOf('\n', i);
            i = nl < 0 ? src.length : nl;
            continue;
        }
        if (ch === '/' && next === '*') {
            const end = src.indexOf('*/', i + 2);
            i = end < 0 ? src.length : end + 2;
            continue;
        }
        if (ch === "'" || ch === '"') {
            i = skipString(src, i);
            continue;
        }
        if (ch === '`') {
            i = skipTemplate(src, i);
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
            i++;
            continue;
        }
        if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
            i++;
            continue;
        }
        if (ch === ',' && depth === 0) {
            args.push(src.slice(start, i));
            start = i + 1;
            i++;
            continue;
        }
        i++;
    }
    args.push(src.slice(start));
    return args.map(arg => arg.trim()).filter(arg => arg.length > 0);
}

// ---------------------------------------------------------------------------------------
// Endpoint extraction
// ---------------------------------------------------------------------------------------

/** Locate the body of a class method (or arrow property) named `name`; return its source text or undefined. */
function findHandlerBody(src, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Method declaration: `protected async handleX(...) {`
    const methodRe = new RegExp(`(^|[\\s;{}])${escaped}\\s*\\(`, 'm');
    const methodMatch = methodRe.exec(src);
    if (methodMatch) {
        const parenIdx = src.indexOf('(', methodMatch.index + methodMatch[0].length - 1);
        if (parenIdx >= 0) {
            const afterParens = scanBalanced(src, parenIdx, '(', ')');
            if (afterParens > 0) {
                const braceIdx = src.indexOf('{', afterParens);
                if (braceIdx >= 0) {
                    const bodyEnd = scanBalanced(src, braceIdx, '{', '}');
                    if (bodyEnd > 0) {
                        return src.slice(braceIdx, bodyEnd);
                    }
                }
            }
        }
    }
    // Arrow property: `protected readonly handleX = (req, res) => {`
    const arrowRe = new RegExp(`(^|[\\s;{}])${escaped}\\s*[:=]\\s*(async\\s*)?(\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`, 'm');
    const arrowMatch = arrowRe.exec(src);
    if (arrowMatch) {
        const arrowIdx = src.indexOf('=>', arrowMatch.index);
        const braceIdx = src.indexOf('{', arrowIdx);
        if (braceIdx >= 0) {
            const bodyEnd = scanBalanced(src, braceIdx, '{', '}');
            if (bodyEnd > 0) {
                return src.slice(braceIdx, bodyEnd);
            }
        }
        // Concise arrow body: `=> this.handleX(req, res)`
        const nl = src.indexOf('\n', arrowIdx);
        return src.slice(arrowIdx, nl < 0 ? src.length : nl);
    }
    return undefined;
}

/** Collect every route registration in one file with its classification. */
function extractEndpoints(absPath) {
    const src = fs.readFileSync(absPath, 'utf8');
    const relPath = path.relative(ROOT, absPath).split(path.sep).join('/');
    const endpoints = [];

    const registration = /([A-Za-z_$][\w$.]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
    let match;
    while ((match = registration.exec(src)) !== null) {
        const receiver = match[1];
        const method = match[2];
        if (!ROUTE_METHODS.includes(method.toLowerCase())) {
            continue;
        }
        if (!RECEIVER.test(receiver)) {
            continue;
        }
        const openIdx = match.index + match[0].length - 1;
        const closeIdx = scanBalanced(src, openIdx, '(', ')');
        if (closeIdx < 0) {
            continue;
        }
        const argsText = src.slice(openIdx + 1, closeIdx - 1);
        const args = splitTopLevelArgs(argsText);
        if (args.length < 2) {
            // A registration without a handler is not a route we can classify.
            continue;
        }
        const route = args[0].replace(/\s+/g, ' ').trim();
        const handlerArgs = args.slice(1);

        // Gather the code that can carry a guard: the middleware/handler arguments themselves,
        // plus the bodies of every `this.method(...)` they delegate to, transitively (bounded).
        const visited = new Set();
        let evidence = handlerArgs.join('\n');
        let frontier = handlerArgs;
        for (let hop = 0; hop < 4 && frontier.length > 0; hop++) {
            const next = [];
            for (const arg of frontier) {
                const delegate = /this\.([A-Za-z_$][\w$]*)\s*\(/g;
                let ref;
                while ((ref = delegate.exec(arg)) !== null) {
                    const name = ref[1];
                    if (visited.has(name)) {
                        continue;
                    }
                    visited.add(name);
                    const body = findHandlerBody(src, name);
                    if (body) {
                        evidence += `\n${body}`;
                        next.push(body);
                    }
                }
            }
            frontier = next;
        }
        const cleaned = stripComments(evidence);
        const hits = GUARD_TOKENS.filter(candidate => cleaned.includes(candidate));
        const line = src.slice(0, match.index).split('\n').length;

        endpoints.push({
            file: relPath,
            line,
            method: method.toUpperCase(),
            route,
            guarded: hits.length > 0,
            markers: hits,
            id: `${relPath} :: ${method.toUpperCase()} ${route}`,
        });
    }
    return endpoints;
}

function listSourceFiles(dir) {
    const out = [];
    if (!fs.existsSync(dir)) {
        return out;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== 'lib') {
                out.push(...listSourceFiles(full));
            }
        } else if (/\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

function collectAll() {
    const packagesDir = path.join(ROOT, 'packages');
    const found = [];
    for (const pkg of fs.readdirSync(packagesDir)) {
        if (!pkg.startsWith('qaap-')) {
            continue;
        }
        const nodeSrc = path.join(packagesDir, pkg, 'src', 'node');
        for (const file of listSourceFiles(nodeSrc)) {
            found.push(...extractEndpoints(file));
        }
        // Frontend sources can register routes against a server object too; scan them for honesty.
        const browserSrc = path.join(packagesDir, pkg, 'src', 'browser');
        for (const file of listSourceFiles(browserSrc)) {
            found.push(...extractEndpoints(file));
        }
    }
    return found.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------------------

function readBaseline() {
    if (!fs.existsSync(BASELINE)) {
        return [];
    }
    return fs.readFileSync(BASELINE, 'utf8')
        .split(/\r?\n/)
        .map(line => line.replace(/#.*/, '').trim())
        .filter(Boolean);
}

function writeBaseline(entries) {
    const header = [
        '# Endpoints in packages/qaap-* that register a route without an auth/ownership primitive.',
        '# This list may only shrink: close the gap (or add the guard) and delete its line.',
        '# Each entry needs a reason on the line above explaining why the route is intentionally public.',
        `# ${entries.length} endpoints.`,
    ];
    fs.writeFileSync(BASELINE, [...header, ...entries, ''].join('\n'));
}

// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------

function main() {
    const endpoints = collectAll();
    const reportOnly = process.argv.includes('--report');
    const guarded = endpoints.filter(endpoint => endpoint.guarded);
    const unguarded = endpoints.filter(endpoint => !endpoint.guarded);

    if (reportOnly) {
        console.log(`[qaap-endpoint-ownership] ${endpoints.length} routes: ${guarded.length} guarded, ${unguarded.length} unguarded.`);
        for (const endpoint of endpoints) {
            const mark = endpoint.guarded ? 'guarded  ' : 'UNGUARDED';
            const detail = endpoint.markers.length > 0 ? ` [${endpoint.markers.join(', ')}]` : '';
            console.log(`  ${mark} ${endpoint.file}:${endpoint.line} ${endpoint.method} ${endpoint.route}${detail}`);
        }
        return;
    }

    if (process.argv.includes('--write')) {
        const previous = new Set(readBaseline());
        const current = unguarded.map(endpoint => endpoint.id);
        const guardedNow = current.filter(id => {
            const endpoint = endpoints.find(candidate => candidate.id === id);
            return endpoint && endpoint.guarded;
        });
        if (guardedNow.length > 0) {
            console.error('[qaap-endpoint-ownership] Refusing to baseline a guarded route:');
            guardedNow.forEach(id => console.error(`  + ${id}`));
            process.exit(2);
        }
        if (previous.size > 0) {
            const growth = current.filter(id => !previous.has(id));
            const guardClosed = [...previous].filter(id => !current.includes(id));
            if (growth.length > 0 && !process.argv.includes('--allow-growth')) {
                console.error('[qaap-endpoint-ownership] Refusing to grow the baseline; these routes lost their guard:');
                growth.forEach(id => console.error(`  + ${id}`));
                console.error('Add the auth/ownership check instead (or pass --allow-growth with a reviewed justification).');
                process.exit(1);
            }
            if (guardClosed.length > 0) {
                console.error('[qaap-endpoint-ownership] Refusing to write while entries are now guarded or gone:');
                guardClosed.forEach(id => console.error(`  - ${id}`));
                process.exit(1);
            }
        }
        writeBaseline(current);
        console.log(`[qaap-endpoint-ownership] Baseline written: ${current.length} unguarded endpoints.`);
        return;
    }

    const baseline = readBaseline();
    const unguardedIds = unguarded.map(endpoint => endpoint.id);
    const newUnguarded = unguardedIds.filter(id => !baseline.includes(id));
    const stale = baseline.filter(id => !unguardedIds.includes(id));

    if (newUnguarded.length === 0 && stale.length === 0) {
        console.log(`[qaap-endpoint-ownership] OK: ${endpoints.length} routes (${guarded.length} guarded); ${baseline.length} known-public in the baseline.`);
        return;
    }
    if (newUnguarded.length > 0) {
        console.error('[qaap-endpoint-ownership] Routes registered without an auth/ownership primitive:');
        for (const id of newUnguarded) {
            const endpoint = endpoints.find(candidate => candidate.id === id);
            console.error(`  + ${id}`);
            if (endpoint) {
                console.error(`      at ${endpoint.file}:${endpoint.line} — add requireAuth/ownerLogin/assertWorkspacePathOwned,`);
                console.error('      or baseline it above a line explaining why the route is intentionally public.');
            }
        }
    }
    if (stale.length > 0) {
        console.error('[qaap-endpoint-ownership] These baseline entries are now guarded or gone; remove them from');
        console.error('  scripts/qaap-endpoint-ownership-baseline.txt (or run with --write):');
        stale.forEach(id => console.error(`  - ${id}`));
    }
    process.exit(1);
}

main();
