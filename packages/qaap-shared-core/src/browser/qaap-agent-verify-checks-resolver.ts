// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { FileUri } from '@theia/core/lib/common/file-uri';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import {
    buildScopedVerifyRunCommand,
    buildVerifyRunCommand,
    packageJsonDeclaresWorkspaces,
    pickMonorepoVerifyTargets,
    QaapVerifyCheckKind,
    QaapVerifyPackageManager,
    QaapVerifyWorkspaceFlavor,
    resolveVerifyCheckFromScripts,
    type QaapLeafVerifyPackage,
} from '../common/qaap-agent-verify-checks';

export interface QaapAgentVerifyCheck {
    readonly label: string;
    readonly command: string;
}

interface PackageJsonShape {
    scripts?: Record<string, unknown>;
    packageManager?: unknown;
}

const LOCKFILE_TO_PM: ReadonlyArray<readonly [string, QaapVerifyPackageManager]> = [
    ['bun.lockb', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['npm-shrinkwrap.json', 'npm'],
];

function localizeVerifyCheckKind(kind: QaapVerifyCheckKind): string {
    switch (kind) {
        case 'build':
            return nls.localize('qaap/mobileProjects/verifyBuild', 'Build');
        case 'test':
            return nls.localize('qaap/mobileProjects/verifyTest', 'Test');
        case 'typecheck':
            return nls.localize('qaap/mobileProjects/verifyTypecheck', 'Typecheck');
        case 'lint':
            return nls.localize('qaap/mobileProjects/verifyLint', 'Lint');
    }
}

async function detectVerifyPackageManager(rootUri: URI, fileService: FileService): Promise<QaapVerifyPackageManager> {
    for (const [fileName, pm] of LOCKFILE_TO_PM) {
        if (await fileService.exists(rootUri.resolve(fileName))) {
            return pm;
        }
    }
    return 'npm';
}

/** Resolves the verify command for an agent conversation cwd from its package.json scripts. */
export async function resolveAgentVerifyChecksForCwd(cwd: string, fileService: FileService): Promise<QaapAgentVerifyCheck[]> {
    const rootUri = FileUri.create(cwd);
    const packageJsonUri = rootUri.resolve('package.json');
    if (!(await fileService.exists(packageJsonUri))) {
        return [];
    }

    let pkg: PackageJsonShape;
    try {
        const content = await fileService.read(packageJsonUri);
        pkg = JSON.parse(content.value || '{}') as PackageJsonShape;
    } catch {
        return [];
    }

    const isMonorepoRoot = packageJsonDeclaresWorkspaces(pkg)
        || await fileService.exists(rootUri.resolve('pnpm-workspace.yaml'))
        || await fileService.exists(rootUri.resolve('lerna.json'));
    const packageManager = await detectVerifyPackageManager(rootUri, fileService);
    if (isMonorepoRoot) {
        const flavor = await detectVerifyWorkspaceFlavor(rootUri, fileService);
        const leaves = await listLeafVerifyPackages(rootUri, fileService);
        const targets = pickMonorepoVerifyTargets(leaves);
        return targets.map(target => ({
            label: `${localizeVerifyCheckKind(target.kind)} (${target.name})`,
            command: buildScopedVerifyRunCommand(target.script, target.name, flavor),
        }));
    }

    const resolved = resolveVerifyCheckFromScripts(
        pkg.scripts,
        script => buildVerifyRunCommand(script, packageManager),
    );
    if (!resolved) {
        return [];
    }

    return [{
        label: localizeVerifyCheckKind(resolved.kind),
        command: resolved.command,
    }];
}

async function detectVerifyWorkspaceFlavor(rootUri: URI, fileService: FileService): Promise<QaapVerifyWorkspaceFlavor> {
    if (await fileService.exists(rootUri.resolve('lerna.json'))) {
        return 'lerna';
    }
    if (await fileService.exists(rootUri.resolve('pnpm-workspace.yaml'))) {
        return 'pnpm';
    }
    return 'npm';
}

async function listLeafVerifyPackages(rootUri: URI, fileService: FileService): Promise<QaapLeafVerifyPackage[]> {
    const found: QaapLeafVerifyPackage[] = [];
    for (const folder of ['packages', 'apps']) {
        try {
            const stat = await fileService.resolve(rootUri.resolve(folder));
            for (const child of (stat.children ?? []).filter(entry => entry.isDirectory).slice(0, 80)) {
                const packageJsonUri = child.resource.resolve('package.json');
                if (!(await fileService.exists(packageJsonUri))) {
                    continue;
                }
                let parsed: { name?: unknown; scripts?: Record<string, unknown> };
                try {
                    const content = await fileService.read(packageJsonUri);
                    parsed = JSON.parse(content.value || '{}') as { name?: unknown; scripts?: Record<string, unknown> };
                } catch {
                    continue;
                }
                if (packageJsonDeclaresWorkspaces(parsed) || typeof parsed.name !== 'string' || !parsed.name.trim()) {
                    continue;
                }
                const resolved = resolveVerifyCheckFromScripts(parsed.scripts);
                if (!resolved) {
                    continue;
                }
                found.push({
                    name: parsed.name.trim(),
                    script: resolved.script,
                    kind: resolved.kind,
                });
            }
        } catch {
            /* folder missing */
        }
    }
    return found;
}
