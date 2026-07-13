// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';

interface PackageJsonProfile {
    readonly name?: unknown;
    readonly packageManager?: unknown;
    readonly scripts?: unknown;
    readonly dependencies?: unknown;
    readonly devDependencies?: unknown;
    readonly workspaces?: unknown;
}

const SCRIPT_PRIORITY = [
    'dev', 'start', 'build', 'typecheck', 'check', 'test', 'lint', 'compile', 'format', 'e2e',
];

const FRAMEWORK_DEPENDENCIES: ReadonlyArray<readonly [string, string]> = [
    ['next', 'Next.js'],
    ['nuxt', 'Nuxt'],
    ['@sveltejs/kit', 'SvelteKit'],
    ['astro', 'Astro'],
    ['@remix-run/dev', 'Remix'],
    ['vite', 'Vite'],
    ['react-scripts', 'Create React App'],
    ['@angular/core', 'Angular'],
    ['gatsby', 'Gatsby'],
    ['@docusaurus/core', 'Docusaurus'],
];

function readText(file: string): string | undefined {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return undefined;
    }
}

function fileExists(cwd: string, name: string): boolean {
    try {
        return fs.existsSync(path.join(cwd, name));
    } catch {
        return false;
    }
}

function resolvePackageManager(cwd: string, declared: unknown): 'npm' | 'pnpm' | 'yarn' | 'bun' {
    if (typeof declared === 'string') {
        const name = declared.trim().split('@')[0];
        if (name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun') {
            return name;
        }
    }
    if (fileExists(cwd, 'pnpm-lock.yaml')) { return 'pnpm'; }
    if (fileExists(cwd, 'yarn.lock')) { return 'yarn'; }
    if (fileExists(cwd, 'bun.lock') || fileExists(cwd, 'bun.lockb')) { return 'bun'; }
    return 'npm';
}

function runScriptCommand(packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun', script: string): string {
    switch (packageManager) {
        case 'pnpm': return `pnpm run ${script}`;
        case 'yarn': return `yarn ${script}`;
        case 'bun': return `bun run ${script}`;
        default: return `npm run ${script}`;
    }
}

function buildNodeProfile(cwd: string): string[] {
    const raw = readText(path.join(cwd, 'package.json'));
    if (!raw) {
        return [];
    }
    let pkg: PackageJsonProfile;
    try {
        pkg = JSON.parse(raw) as PackageJsonProfile;
    } catch {
        return ['Runtime: Node.js (package.json is not valid JSON)'];
    }
    const lines = ['Runtime: Node.js'];
    if (typeof pkg.name === 'string' && pkg.name.trim()) {
        lines.push(`Package: ${pkg.name.trim()}`);
    }
    const packageManager = resolvePackageManager(cwd, pkg.packageManager);
    lines.push(`Package manager: ${packageManager}`);
    const dependencies = {
        ...(pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}),
        ...(pkg.devDependencies && typeof pkg.devDependencies === 'object' ? pkg.devDependencies : {}),
    } as Record<string, unknown>;
    const frameworks = FRAMEWORK_DEPENDENCIES
        .filter(([dependency]) => dependency in dependencies)
        .map(([, label]) => label);
    if (frameworks.length > 0) {
        lines.push(`Framework/tooling: ${[...new Set(frameworks)].join(', ')}`);
    }
    const monorepoMarkers = [
        pkg.workspaces ? 'package workspaces' : undefined,
        fileExists(cwd, 'pnpm-workspace.yaml') ? 'pnpm workspace' : undefined,
        fileExists(cwd, 'turbo.json') ? 'Turborepo' : undefined,
        fileExists(cwd, 'nx.json') ? 'Nx' : undefined,
        fileExists(cwd, 'lerna.json') ? 'Lerna' : undefined,
    ].filter((marker): marker is string => !!marker);
    if (monorepoMarkers.length > 0) {
        lines.push(`Repository layout: ${monorepoMarkers.join(', ')}`);
    }
    const scripts = pkg.scripts && typeof pkg.scripts === 'object'
        ? pkg.scripts as Record<string, unknown>
        : {};
    const orderedScripts = [
        ...SCRIPT_PRIORITY.filter(name => typeof scripts[name] === 'string'),
        ...Object.keys(scripts).filter(name => !SCRIPT_PRIORITY.includes(name) && typeof scripts[name] === 'string').sort(),
    ].slice(0, 12);
    if (orderedScripts.length > 0) {
        lines.push('Known commands:');
        lines.push(...orderedScripts.map(script => `- ${runScriptCommand(packageManager, script)}`));
    }
    return lines;
}

function buildNonNodeProfile(cwd: string): string[] {
    if (fileExists(cwd, 'pyproject.toml')) {
        const pyproject = readText(path.join(cwd, 'pyproject.toml')) ?? '';
        const lines = ['Runtime: Python'];
        const commands: string[] = [];
        if (/\[tool\.pytest|pytest/i.test(pyproject)) { commands.push('pytest'); }
        if (/\[tool\.ruff|ruff/i.test(pyproject)) { commands.push('ruff check .'); }
        if (/\[tool\.mypy|mypy/i.test(pyproject)) { commands.push('mypy .'); }
        if (commands.length > 0) {
            lines.push('Known commands:', ...commands.map(command => `- ${command}`));
        }
        return lines;
    }
    if (fileExists(cwd, 'Cargo.toml')) {
        return ['Runtime: Rust', 'Known commands:', '- cargo check', '- cargo test'];
    }
    if (fileExists(cwd, 'go.mod')) {
        return ['Runtime: Go', 'Known commands:', '- go test ./...'];
    }
    if (fileExists(cwd, 'pom.xml')) {
        return ['Runtime: Java (Maven)', 'Known commands:', '- mvn test'];
    }
    if (fileExists(cwd, 'build.gradle') || fileExists(cwd, 'build.gradle.kts')) {
        return ['Runtime: Java/Kotlin (Gradle)', 'Known commands:', '- ./gradlew test'];
    }
    return [];
}

/** Compact, automatically-derived project facts prepended to every cold agent turn. */
export function buildQaapAgentRepoProfile(cwd: string): string | undefined {
    const lines = buildNodeProfile(cwd);
    if (lines.length === 0) {
        lines.push(...buildNonNodeProfile(cwd));
    }
    return lines.length > 0 ? `Project profile:\n${lines.join('\n')}` : undefined;
}
