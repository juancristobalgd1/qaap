// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { buildBootstrapInstallCommand } from './qaap-project-bootstrap-install';
import {
    parseDeclaredPackageManager,
    parseNpmrcPackageManager,
    parsePnpmWorkspaceYaml,
} from './qaap-project-bootstrap-pm-detect';
import {
    QAAP_STATIC_DEV_PORT,
    QAAP_THEIA_DEV_PORT,
    QaapMonorepoAppCandidate,
    QaapMonorepoFlavor,
    QaapPackageManager,
    QaapProjectDescriptor,
    QaapProjectKind,
} from './qaap-project-bootstrap-types';
import {
    STATIC_INDEX_FILE,
    STATIC_INSTALL_COMMAND,
    STATIC_ROOT_CANDIDATE_DIRS,
    buildStaticServeCommand,
} from './qaap-project-bootstrap-static';
import { formatMissingBootstrapProjectHint } from '../common/qaap-project-bootstrap-scaffold-plan';
import {
    QAAP_PREVIEW_CONFIG_PATH,
    QaapPreviewLaunchPlan,
    parseQaapPreviewLaunchConfigJson,
    renderQaapPreviewLaunchCommand,
} from '../common/qaap-preview-launch-plan';

interface PackageJsonShape {
    name?: unknown;
    bin?: unknown;
    scripts?: Record<string, unknown>;
    packageManager?: unknown;
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
    workspaces?: unknown;
}

/** Hard cap on sub-apps enumerated so we never freeze the UI on enormous monorepos. */
const MAX_MONOREPO_APPS = 32;

/** Hard cap on direct-child scaffold folders probed when the workspace root has no manifest. */
const MAX_SCAFFOLD_SUBFOLDER_APPS = 16;

/** Directories skipped when scanning for orphan scaffold projects under the workspace root. */
const SCAFFOLD_SUBFOLDER_SKIP = new Set(['node_modules', '.git', '.qaap', 'dist', 'build', 'out']);

/** Extra `index.html` folders nested under {@link STATIC_ROOT_CANDIDATE_DIRS} (e.g. `docs/demo`). */
const NESTED_STATIC_INDEX_SEGMENTS = ['demo', 'public', 'dist'] as const;

/** Fallback directories scanned when no explicit workspaces config exists ("implicit" layout). */
const IMPLICIT_MONOREPO_DIRS = ['apps', 'packages', 'examples', 'sites', 'services', 'artifacts'];

/** Scripts the detector will pick up as a "dev server" entry point, in priority order. */
const DEV_SCRIPT_PRIORITY = ['dev', 'start', 'serve', 'develop'];

const LOCKFILE_TO_PM: ReadonlyArray<readonly [string, QaapPackageManager]> = [
    ['bun.lockb', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['npm-shrinkwrap.json', 'npm'],
];

const FRAMEWORK_BY_DEP: ReadonlyArray<readonly [string, QaapProjectKind, number | undefined]> = [
    ['next', 'node-next', 3000],
    ['nuxt', 'node-nuxt', 3000],
    ['@remix-run/dev', 'node-remix', 3000],
    ['@remix-run/serve', 'node-remix', 3000],
    ['astro', 'node-astro', 4321],
    ['@sveltejs/kit', 'node-svelte', 5173],
    ['react-scripts', 'node-cra', 3000],
    ['vite', 'node-vite', 5173],
];

/** Fallback for repos that invoke a framework CLI from scripts without declaring it locally. */
const FRAMEWORK_BY_SCRIPT: ReadonlyArray<readonly [RegExp, QaapProjectKind, number | undefined]> = [
    [/\bnext(?:\.js)?\s+dev\b/i, 'node-next', 3000],
    [/\bnuxt\s+(?:dev|start)\b/i, 'node-nuxt', 3000],
    [/\bastro\s+dev\b/i, 'node-astro', 4321],
    [/\b(?:remix|remix-serve)\b/i, 'node-remix', 3000],
    [/\bsvelte-kit\s+dev\b/i, 'node-svelte', 5173],
    [/\breact-scripts\s+start\b/i, 'node-cra', 3000],
    [/\bvite(?:\s|$)/i, 'node-vite', 5173],
];

/** PORT=4173, --port 4173, --port=4173, or -p 4173 in a dev script. */
const EXPLICIT_SCRIPT_PORT_REGEX = /(?:\bPORT\s*=\s*|--port(?:\s+|=)|(?:^|\s)-p\s+)(\d{2,5})\b/i;

const NATIVE_INSTALL_COMMAND = buildBootstrapInstallCommand('native');

@injectable()
export class QaapProjectBootstrapDetector {

    @inject(FileService)
    protected readonly fileService: FileService;

    async detect(rootUri: URI): Promise<QaapProjectDescriptor | undefined> {
        const configured = await this.detectConfiguredPreview(rootUri);
        if (configured) {
            return configured;
        }
        const packageJsonUri = rootUri.resolve('package.json');
        if (!(await this.fileService.exists(packageJsonUri))) {
            // No Node project: fall back to serving a plain static site (index.html) if present, so
            // hand-written / exported front-ends get the same one-tap preview and AI bootstrap tools.
            const staticSite = await this.detectStaticSite(rootUri);
            if (staticSite) {
                return staticSite;
            }
            const scaffolded = await this.detectScaffoldedSubfolder(rootUri);
            return scaffolded ?? this.detectNativeProject(rootUri);
        }

        let pkg: PackageJsonShape;
        try {
            const content = await this.fileService.read(packageJsonUri);
            pkg = JSON.parse(content.value || '{}') as PackageJsonShape;
        } catch {
            return undefined;
        }

        const name = typeof pkg.name === 'string' && pkg.name.trim().length > 0
            ? pkg.name.trim()
            : rootUri.path.base || 'project';

        const packageManager = await this.detectPackageManager(rootUri, pkg);
        const installCommand = buildBootstrapInstallCommand(packageManager);

        const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
        const devScriptKey = this.pickDevScript(scripts);
        const { kind, expectedPort } = this.guessFramework(pkg);

        let devCommand: string | undefined;
        let devCommandLabel: string | undefined;
        if (devScriptKey) {
            devCommand = this.buildRunCommand(packageManager, devScriptKey);
            devCommandLabel = devCommand;
        }

        const { flavor, apps } = await this.detectMonorepo(rootUri, pkg, packageManager);
        const nodeModulesPresent = await this.resolveNodeModulesPresent(rootUri, kind, packageManager, apps);

        // A package.json without any dev/start script and no runnable monorepo apps cannot serve a
        // preview — but a plain index.html next to it can (hand-written sites whose package.json
        // only tracks a lockfile or utilities). Fall back to the static server so "just an HTML
        // file" still gets the one-tap preview, whatever the stack.
        if (!devCommand && apps.length === 0) {
            const staticSite = await this.detectStaticSite(rootUri);
            if (staticSite) {
                return { ...staticSite, name };
            }
            const native = await this.detectNativeProject(rootUri);
            if (native) {
                return native;
            }
        }

        return {
            rootUri,
            name,
            kind,
            packageManager,
            installCommand,
            devCommand,
            devCommandLabel,
            expectedPort,
            nodeModulesPresent,
            monorepoFlavor: flavor,
            apps,
        };
    }

    /** Explicit launch configuration is authoritative, including for mixed-language repos. */
    protected async detectConfiguredPreview(rootUri: URI): Promise<QaapProjectDescriptor | undefined> {
        const configUri = rootUri.resolve(QAAP_PREVIEW_CONFIG_PATH);
        if (!(await this.fileService.exists(configUri))) {
            return undefined;
        }
        try {
            const content = await this.fileService.read(configUri);
            const parsed = parseQaapPreviewLaunchConfigJson(content.value || '');
            if (!parsed.ok) {
                return undefined;
            }
            return this.descriptorForNativePlan(rootUri, parsed.plan, this.kindForConfiguredRuntime(parsed.plan));
        } catch {
            return undefined;
        }
    }

    /** Conservative marker-based discovery. Ambiguous Python entry points require preview.json. */
    protected async detectNativeProject(workspaceRoot: URI): Promise<QaapProjectDescriptor | undefined> {
        const atRoot = await this.detectNativeProjectAt(workspaceRoot, workspaceRoot);
        if (atRoot) {
            return atRoot;
        }
        try {
            const resolved = await this.fileService.resolve(workspaceRoot);
            const children = (resolved.children ?? [])
                .filter(child => child.isDirectory && !SCAFFOLD_SUBFOLDER_SKIP.has(child.name))
                .slice(0, MAX_SCAFFOLD_SUBFOLDER_APPS);
            for (const child of children) {
                const detected = await this.detectNativeProjectAt(workspaceRoot, child.resource);
                if (detected) {
                    return detected;
                }
            }
        } catch {
            // An unreadable workspace is simply not auto-runnable.
        }
        return undefined;
    }

    protected async detectNativeProjectAt(
        workspaceRoot: URI,
        projectRoot: URI,
    ): Promise<QaapProjectDescriptor | undefined> {
        if (await this.fileService.exists(projectRoot.resolve('manage.py'))) {
            return this.descriptorForNativePlan(workspaceRoot, {
                version: 1,
                runtime: 'python',
                name: projectRoot.path.base || 'Django app',
                cwd: this.relativePathFromRoot(workspaceRoot, projectRoot) ?? '.',
                command: 'python3',
                args: ['manage.py', 'runserver', '0.0.0.0:{{PORT}}'],
                port: 8000,
            }, 'python-django');
        }
        const pythonManifest = await this.readFirstText(projectRoot, ['requirements.txt', 'pyproject.toml']);
        if (pythonManifest && await this.fileService.exists(projectRoot.resolve('app.py'))) {
            if (/\b(?:fastapi|uvicorn)\b/i.test(pythonManifest)) {
                return this.descriptorForNativePlan(workspaceRoot, {
                    version: 1,
                    runtime: 'python',
                    name: projectRoot.path.base || 'FastAPI app',
                    cwd: this.relativePathFromRoot(workspaceRoot, projectRoot) ?? '.',
                    command: 'python3',
                    args: ['-m', 'uvicorn', 'app:app', '--host', '0.0.0.0', '--port', '{{PORT}}'],
                    port: 8000,
                }, 'python-fastapi');
            }
            if (/\bflask\b/i.test(pythonManifest)) {
                return this.descriptorForNativePlan(workspaceRoot, {
                    version: 1,
                    runtime: 'python',
                    name: projectRoot.path.base || 'Flask app',
                    cwd: this.relativePathFromRoot(workspaceRoot, projectRoot) ?? '.',
                    command: 'python3',
                    args: ['-m', 'flask', '--app', 'app', 'run', '--host', '0.0.0.0', '--port', '{{PORT}}'],
                    port: 5000,
                }, 'python-flask');
            }
        }
        if (await this.fileService.exists(projectRoot.resolve('go.mod'))) {
            return this.descriptorForNativePlan(workspaceRoot, this.nativePlan(projectRoot, workspaceRoot, 'go', 'go', ['run', '.']), 'go');
        }
        if (await this.fileService.exists(projectRoot.resolve('Cargo.toml'))) {
            return this.descriptorForNativePlan(workspaceRoot, this.nativePlan(projectRoot, workspaceRoot, 'rust', 'cargo', ['run']), 'rust');
        }
        const csproj = await this.findDotnetProject(projectRoot);
        if (csproj) {
            return this.descriptorForNativePlan(workspaceRoot, this.nativePlan(
                projectRoot, workspaceRoot, 'dotnet', 'dotnet', ['run', '--project', csproj, '--urls', 'http://0.0.0.0:{{PORT}}'],
            ), 'dotnet');
        }
        if (await this.fileService.exists(projectRoot.resolve('index.php'))) {
            return this.descriptorForNativePlan(workspaceRoot, this.nativePlan(
                projectRoot, workspaceRoot, 'php', 'php', ['-S', '0.0.0.0:{{PORT}}'],
            ), 'php');
        }
        return undefined;
    }

    protected nativePlan(
        projectRoot: URI,
        workspaceRoot: URI,
        runtime: QaapPreviewLaunchPlan['runtime'],
        command: string,
        args: string[],
    ): QaapPreviewLaunchPlan {
        return {
            version: 1,
            runtime,
            name: projectRoot.path.base || `${runtime} app`,
            cwd: this.relativePathFromRoot(workspaceRoot, projectRoot) ?? '.',
            command,
            args,
            port: 8080,
        };
    }

    protected async readFirstText(root: URI, names: readonly string[]): Promise<string | undefined> {
        for (const name of names) {
            const uri = root.resolve(name);
            if (await this.fileService.exists(uri)) {
                try {
                    return (await this.fileService.read(uri)).value || '';
                } catch {
                    return undefined;
                }
            }
        }
        return undefined;
    }

    protected async findDotnetProject(root: URI): Promise<string | undefined> {
        try {
            const resolved = await this.fileService.resolve(root);
            return (resolved.children ?? [])
                .filter(child => child.isFile && child.name.toLowerCase().endsWith('.csproj'))
                .map(child => child.name)
                .sort()[0];
        } catch {
            return undefined;
        }
    }

    protected descriptorForNativePlan(
        workspaceRoot: URI,
        plan: QaapPreviewLaunchPlan,
        kind: QaapProjectKind,
    ): QaapProjectDescriptor {
        const previewRootUri = plan.cwd === '.' ? workspaceRoot : workspaceRoot.resolve(plan.cwd);
        return {
            rootUri: workspaceRoot,
            previewRootUri,
            name: plan.name ?? workspaceRoot.path.base ?? 'app',
            kind,
            packageManager: 'native',
            installCommand: NATIVE_INSTALL_COMMAND,
            devCommand: renderQaapPreviewLaunchCommand(plan),
            devCommandLabel: [plan.command, ...plan.args].join(' '),
            expectedPort: plan.port,
            nodeModulesPresent: true,
            apps: [],
            scaffoldRelativePath: plan.cwd === '.' ? undefined : plan.cwd,
        };
    }

    protected kindForConfiguredRuntime(plan: QaapPreviewLaunchPlan): QaapProjectKind {
        switch (plan.runtime) {
            case 'python': return 'python-generic';
            case 'go': return 'go';
            case 'rust': return 'rust';
            case 'dotnet': return 'dotnet';
            case 'php': return 'php';
            default: return 'custom';
        }
    }

    /**
     * Builds a descriptor for a static front-end (no `package.json`). Looks for `index.html` at the
     * workspace root first, then in conventional output / source folders. The synthesized dev
     * command runs a zero-dependency inline Node static server (see `qaap-project-bootstrap-static`),
     * so the rest of the bootstrap pipeline (auto-run banner, AI tools, preview) works unchanged.
     */
    protected async detectStaticSite(rootUri: URI): Promise<QaapProjectDescriptor | undefined> {
        const staticRootRel = await this.findStaticRoot(rootUri);
        if (staticRootRel === undefined) {
            return undefined;
        }
        const devCommand = buildStaticServeCommand(staticRootRel);
        const label = staticRootRel === '.' ? 'index.html' : `${staticRootRel}/index.html`;
        return {
            rootUri,
            name: rootUri.path.base || 'static-site',
            kind: 'static',
            packageManager: 'npm',
            installCommand: STATIC_INSTALL_COMMAND,
            devCommand,
            devCommandLabel: `Static server · ${label}`,
            expectedPort: QAAP_STATIC_DEV_PORT,
            // Nothing to install for a static site, so the pipeline goes straight to "ready-to-run".
            nodeModulesPresent: true,
            monorepoFlavor: undefined,
            apps: [],
        };
    }

    /**
     * Returns the directory (relative to the workspace root) that holds `index.html`, or `undefined`
     * when the workspace is not a servable static site. `'.'` means the root itself.
     */
    protected async findStaticRoot(rootUri: URI): Promise<string | undefined> {
        if (await this.fileService.exists(rootUri.resolve(STATIC_INDEX_FILE))) {
            return '.';
        }
        for (const dir of STATIC_ROOT_CANDIDATE_DIRS) {
            if (await this.fileService.exists(rootUri.resolve(dir).resolve(STATIC_INDEX_FILE))) {
                return dir;
            }
        }
        for (const dir of STATIC_ROOT_CANDIDATE_DIRS) {
            for (const nested of NESTED_STATIC_INDEX_SEGMENTS) {
                const rel = `${dir}/${nested}`;
                if (await this.fileService.exists(rootUri.resolve(rel).resolve(STATIC_INDEX_FILE))) {
                    return rel;
                }
            }
        }
        return undefined;
    }

    /**
     * Lists runnable child folders (direct children with `package.json` + dev script). Used when
     * agents scaffold with `create-vite` / `npm create` into a subfolder instead of the workspace root.
     */
    async listScaffoldSubfolderCandidates(workspaceRoot: URI): Promise<QaapMonorepoAppCandidate[]> {
        return this.enumerateScaffoldSubfolderApps(workspaceRoot);
    }

    /** Human-readable hint when preview cannot run because the workspace root has no manifest. */
    formatMissingProjectHint(candidatePaths: readonly string[]): string | undefined {
        return formatMissingBootstrapProjectHint(candidatePaths);
    }

    /**
     * When the workspace root has no Node manifest, look for a freshly scaffolded app in a direct
     * child folder (common `create-vite` / `npm create` layout).
     */
    protected async detectScaffoldedSubfolder(workspaceRoot: URI): Promise<QaapProjectDescriptor | undefined> {
        const apps = await this.enumerateScaffoldSubfolderApps(workspaceRoot);
        if (apps.length === 0) {
            return undefined;
        }
        const primary = apps[0];
        const packageManager = await this.detectPackageManager(primary.rootUri, await this.readPackageJson(primary.rootUri));
        const installCommand = buildBootstrapInstallCommand(packageManager);
        const nodeModulesPresent = await this.resolveNodeModulesPresent(
            workspaceRoot,
            primary.kind,
            packageManager,
            apps,
        );
        const scaffoldRelativePath = primary.relativePath;
        if (apps.length === 1) {
            return {
                rootUri: workspaceRoot,
                name: primary.name,
                kind: primary.kind,
                packageManager,
                installCommand,
                expectedPort: primary.expectedPort,
                nodeModulesPresent,
                monorepoFlavor: undefined,
                apps,
                scaffoldRelativePath,
            };
        }
        return {
            rootUri: workspaceRoot,
            name: workspaceRoot.path.base || 'project',
            kind: primary.kind,
            packageManager,
            installCommand,
            nodeModulesPresent,
            monorepoFlavor: 'implicit',
            apps,
        };
    }

    protected async enumerateScaffoldSubfolderApps(workspaceRoot: URI): Promise<QaapMonorepoAppCandidate[]> {
        const apps: QaapMonorepoAppCandidate[] = [];
        try {
            const stat = await this.fileService.resolve(workspaceRoot);
            for (const child of stat.children ?? []) {
                if (apps.length >= MAX_SCAFFOLD_SUBFOLDER_APPS) {
                    break;
                }
                if (!child.isDirectory) {
                    continue;
                }
                if (child.name.startsWith('.') || SCAFFOLD_SUBFOLDER_SKIP.has(child.name)) {
                    continue;
                }
                const pm = await this.detectPackageManager(child.resource, await this.readPackageJson(child.resource));
                const candidate = await this.toAppCandidate(workspaceRoot, child.resource, pm);
                if (candidate) {
                    apps.push(candidate);
                }
            }
        } catch {
            return [];
        }
        apps.sort((a, b) => this.compareScaffoldCandidates(a, b));
        return apps;
    }

    protected compareScaffoldCandidates(a: QaapMonorepoAppCandidate, b: QaapMonorepoAppCandidate): number {
        const score = (kind: QaapProjectKind): number => {
            switch (kind) {
                case 'node-vite': return 0;
                case 'node-next': return 1;
                case 'node-astro': return 2;
                case 'node-svelte': return 3;
                case 'node-remix': return 4;
                case 'node-cra': return 5;
                case 'node-nuxt': return 6;
                default: return 10;
            }
        };
        const byKind = score(a.kind) - score(b.kind);
        if (byKind !== 0) {
            return byKind;
        }
        return a.relativePath.localeCompare(b.relativePath);
    }

    protected async readPackageJson(packageRoot: URI): Promise<PackageJsonShape> {
        try {
            const content = await this.fileService.read(packageRoot.resolve('package.json'));
            return JSON.parse(content.value || '{}') as PackageJsonShape;
        } catch {
            return {};
        }
    }

    /**
     * Returns the monorepo flavor (workspaces / turbo / nx / pnpm-workspace / …) and the runnable
     * sub-apps. Apps are filtered to ones that ship a `dev`-like script so the UI can offer them
     * as one-tap previews. When no marker is found and the workspace contains conventional
     * `apps/*` or `packages/*` folders with `package.json`, we treat it as an implicit monorepo.
     */
    protected async detectMonorepo(
        rootUri: URI,
        pkg: PackageJsonShape,
        pm: QaapPackageManager,
    ): Promise<{ flavor: QaapMonorepoFlavor | undefined; apps: QaapMonorepoAppCandidate[] }> {
        const { flavor, patterns } = await this.detectMonorepoLayout(rootUri, pkg);
        if (!flavor && patterns.length === 0) {
            return { flavor: undefined, apps: [] };
        }
        const candidateUris = await this.resolveWorkspacePatterns(rootUri, patterns);
        const apps: QaapMonorepoAppCandidate[] = [];
        for (const appUri of candidateUris) {
            if (apps.length >= MAX_MONOREPO_APPS) {
                break;
            }
            const candidate = await this.toAppCandidate(rootUri, appUri, pm);
            if (candidate) {
                apps.push(candidate);
            }
        }
        // Keep apps in a stable, predictable order: `apps/*` first, then alphabetically.
        apps.sort((a, b) => {
            const aIsApps = a.relativePath.startsWith('apps/') ? 0 : 1;
            const bIsApps = b.relativePath.startsWith('apps/') ? 0 : 1;
            if (aIsApps !== bIsApps) {
                return aIsApps - bIsApps;
            }
            return a.relativePath.localeCompare(b.relativePath);
        });
        if (apps.length === 0) {
            return { flavor, apps: [] };
        }
        return { flavor: flavor ?? 'implicit', apps };
    }

    /**
     * Resolves the workspace marker (pnpm-workspace.yaml, package.json `workspaces`, turbo.json,
     * nx.json, lerna.json) and returns the glob patterns to enumerate. Falls back to the
     * conventional `apps/*` / `packages/*` set when only a build-graph file (turbo/nx) is found
     * without an explicit packages list.
     */
    protected async detectMonorepoLayout(
        rootUri: URI,
        pkg: PackageJsonShape,
    ): Promise<{ flavor: QaapMonorepoFlavor | undefined; patterns: string[] }> {
        const pnpmWorkspace = rootUri.resolve('pnpm-workspace.yaml');
        if (await this.fileService.exists(pnpmWorkspace)) {
            try {
                const content = await this.fileService.read(pnpmWorkspace);
                let patterns = parsePnpmWorkspaceYaml(content.value || '');
                if (patterns.length === 0) {
                    patterns = this.parseNpmWorkspacesField(pkg.workspaces);
                }
                if (patterns.length === 0) {
                    patterns = await this.implicitMonorepoPatterns(rootUri);
                }
                return { flavor: 'pnpm-workspace', patterns };
            } catch {
                /* fall through */
            }
        }
        if (Array.isArray(pkg.workspaces) || (pkg.workspaces && typeof pkg.workspaces === 'object')) {
            const patterns = this.parseNpmWorkspacesField(pkg.workspaces);
            const flavor = await this.workspacesFlavorFromLockfiles(rootUri);
            return { flavor, patterns };
        }
        const lernaJson = rootUri.resolve('lerna.json');
        if (await this.fileService.exists(lernaJson)) {
            try {
                const content = await this.fileService.read(lernaJson);
                const parsed = JSON.parse(content.value || '{}');
                if (Array.isArray(parsed.packages)) {
                    return { flavor: 'lerna', patterns: this.coercePatternArray(parsed.packages) };
                }
            } catch {
                /* fall through */
            }
            // lerna without explicit `packages` defaults to packages/*.
            return { flavor: 'lerna', patterns: ['packages/*'] };
        }
        const turboJson = rootUri.resolve('turbo.json');
        if (await this.fileService.exists(turboJson)) {
            return { flavor: 'turborepo', patterns: ['apps/*', 'packages/*'] };
        }
        const nxJson = rootUri.resolve('nx.json');
        if (await this.fileService.exists(nxJson)) {
            return { flavor: 'nx', patterns: ['apps/*', 'packages/*', 'libs/*'] };
        }
        const implicitPatterns = await this.implicitMonorepoPatterns(rootUri);
        return { flavor: implicitPatterns.length ? 'implicit' : undefined, patterns: implicitPatterns };
    }

    protected async implicitMonorepoPatterns(rootUri: URI): Promise<string[]> {
        const implicitPatterns: string[] = [];
        for (const dir of IMPLICIT_MONOREPO_DIRS) {
            if (await this.fileService.exists(rootUri.resolve(dir))) {
                implicitPatterns.push(`${dir}/*`);
            }
        }
        return implicitPatterns;
    }

    protected async workspacesFlavorFromLockfiles(rootUri: URI): Promise<QaapMonorepoFlavor> {
        if (await this.fileService.exists(rootUri.resolve('pnpm-lock.yaml'))) {
            return 'pnpm-workspace';
        }
        if (await this.fileService.exists(rootUri.resolve('yarn.lock'))) {
            return 'yarn-workspaces';
        }
        return 'npm-workspaces';
    }

    protected parseNpmWorkspacesField(field: unknown): string[] {
        if (Array.isArray(field)) {
            return this.coercePatternArray(field);
        }
        if (field && typeof field === 'object') {
            const packages = (field as { packages?: unknown }).packages;
            if (Array.isArray(packages)) {
                return this.coercePatternArray(packages);
            }
        }
        return [];
    }

    protected coercePatternArray(items: unknown[]): string[] {
        const out: string[] = [];
        for (const item of items) {
            if (typeof item === 'string' && item.trim().length > 0) {
                out.push(item.trim());
            }
        }
        return out;
    }

    /**
     * Expands the workspace globs into folder URIs. Only the trailing `*` pattern is supported
     * (`apps/*`, `packages/*`, `services/*`, …) — that covers virtually every monorepo we have
     * seen in the wild and avoids pulling in a glob dependency.
     */
    protected async resolveWorkspacePatterns(rootUri: URI, patterns: string[]): Promise<URI[]> {
        const seen = new Set<string>();
        const out: URI[] = [];
        for (const pattern of patterns) {
            const sanitized = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
            if (sanitized.includes('**')) {
                // Skip deep globs; we deliberately keep this scan bounded.
                continue;
            }
            if (sanitized.endsWith('/*')) {
                const parentRel = sanitized.slice(0, -2);
                const parentUri = parentRel.length ? rootUri.resolve(parentRel) : rootUri;
                if (!(await this.fileService.exists(parentUri))) {
                    continue;
                }
                try {
                    const stat = await this.fileService.resolve(parentUri);
                    for (const child of stat.children ?? []) {
                        if (!child.isDirectory) {
                            continue;
                        }
                        if (child.name.startsWith('.') || child.name === 'node_modules') {
                            continue;
                        }
                        const key = child.resource.toString();
                        if (seen.has(key)) {
                            continue;
                        }
                        seen.add(key);
                        out.push(child.resource);
                    }
                } catch {
                    /* directory not readable — skip */
                }
                continue;
            }
            if (sanitized.includes('*')) {
                // Other wildcards aren't supported yet; ignore quietly.
                continue;
            }
            // Plain folder reference (no glob): treat as a single app.
            const direct = rootUri.resolve(sanitized);
            if (await this.fileService.exists(direct)) {
                const key = direct.toString();
                if (!seen.has(key)) {
                    seen.add(key);
                    out.push(direct);
                }
            }
        }
        return out;
    }

    protected async toAppCandidate(
        rootUri: URI,
        appUri: URI,
        rootPm: QaapPackageManager,
    ): Promise<QaapMonorepoAppCandidate | undefined> {
        const packageJsonUri = appUri.resolve('package.json');
        if (!(await this.fileService.exists(packageJsonUri))) {
            return undefined;
        }
        let pkg: PackageJsonShape;
        try {
            const content = await this.fileService.read(packageJsonUri);
            pkg = JSON.parse(content.value || '{}') as PackageJsonShape;
        } catch {
            return undefined;
        }
        const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
        const devScriptKey = this.pickDevScript(scripts);
        if (!devScriptKey) {
            return undefined;
        }
        const { kind, expectedPort } = this.guessFramework(pkg);
        const pkgName = typeof pkg.name === 'string' && pkg.name.trim().length > 0
            ? pkg.name.trim()
            : appUri.path.base || 'app';
        const devCommand = this.buildMonorepoDevCommand(rootPm, devScriptKey, pkgName);
        const relativePath = this.relativePathFromRoot(rootUri, appUri) ?? pkgName;
        return {
            rootUri: appUri,
            relativePath,
            name: pkgName,
            kind,
            devCommand,
            devCommandLabel: devCommand,
            expectedPort,
        };
    }

    protected relativePathFromRoot(rootUri: URI, appUri: URI): string | undefined {
        const rel = rootUri.relative(appUri);
        if (!rel) {
            return undefined;
        }
        return rel.toString().replace(/\\/g, '/');
    }

    protected async detectPackageManager(rootUri: URI, pkg: PackageJsonShape): Promise<QaapPackageManager> {
        if (typeof pkg.packageManager === 'string') {
            const fromField = parseDeclaredPackageManager(pkg.packageManager);
            if (fromField) {
                return fromField;
            }
        }
        const npmrcUri = rootUri.resolve('.npmrc');
        if (await this.fileService.exists(npmrcUri)) {
            try {
                const npmrc = await this.fileService.read(npmrcUri);
                const fromNpmrc = parseNpmrcPackageManager(npmrc.value || '');
                if (fromNpmrc) {
                    return fromNpmrc;
                }
            } catch {
                /* ignore unreadable .npmrc */
            }
        }
        for (const [lockfile, pm] of LOCKFILE_TO_PM) {
            if (await this.fileService.exists(rootUri.resolve(lockfile))) {
                return pm;
            }
        }
        return 'npm';
    }

    protected async resolveNodeModulesPresent(
        rootUri: URI,
        kind: QaapProjectKind,
        pm: QaapPackageManager,
        apps: QaapMonorepoAppCandidate[],
    ): Promise<boolean> {
        if (apps.length > 0) {
            for (const app of apps) {
                if (await this.fileService.exists(app.rootUri.resolve('node_modules'))
                    && await this.isDevToolingPresent(app.rootUri, app.kind, rootUri)) {
                    return true;
                }
            }
        }
        const hasRootModules = await this.fileService.exists(rootUri.resolve('node_modules'));
        if (!hasRootModules) {
            return false;
        }
        if (pm === 'pnpm' && await this.fileService.exists(rootUri.resolve('node_modules/.pnpm'))) {
            return true;
        }
        if (apps.length > 0) {
            for (const app of apps) {
                if (await this.isDevToolingPresent(app.rootUri, app.kind, rootUri)) {
                    return true;
                }
            }
        }
        return this.isDevToolingPresent(rootUri, kind, rootUri);
    }

    /**
     * `node_modules` alone is not enough on Docker (NODE_ENV=production installs omit devDependencies).
     * Require the CLI shim the dev script needs when we can infer it.
     * Monorepo apps often hoist binaries to the workspace root (pnpm/npm workspaces).
     */
    protected async isDevToolingPresent(
        packageRootUri: URI,
        kind: QaapProjectKind,
        workspaceRootUri?: URI,
    ): Promise<boolean> {
        const bin = this.devToolBinaryForKind(kind);
        if (!bin) {
            return true;
        }
        if (await this.fileService.exists(packageRootUri.resolve(`node_modules/.bin/${bin}`))) {
            return true;
        }
        const workspaceRoot = workspaceRootUri ?? packageRootUri;
        if (workspaceRoot.toString() !== packageRootUri.toString()) {
            return this.fileService.exists(workspaceRoot.resolve(`node_modules/.bin/${bin}`));
        }
        return false;
    }

    protected devToolBinaryForKind(kind: QaapProjectKind): string | undefined {
        switch (kind) {
            case 'node-vite':
            case 'node-svelte':
                return 'vite';
            case 'node-next':
                return 'next';
            case 'node-nuxt':
                return 'nuxt';
            case 'node-astro':
                return 'astro';
            case 'node-remix':
                return 'remix';
            case 'node-cra':
                return 'react-scripts';
            default:
                return undefined;
        }
    }

    protected buildRunCommand(pm: QaapPackageManager, script: string): string {
        switch (pm) {
            case 'pnpm': return `pnpm run ${script}`;
            case 'yarn': return `yarn ${script}`;
            case 'bun': return `bun run ${script}`;
            default: return `npm run ${script}`;
        }
    }

    /**
     * pnpm workspaces must run from the repo root via `--filter`, not `pnpm run dev` inside the
     * package folder (Docker/VPS often only has pnpm via Corepack at the workspace root).
     */
    protected buildMonorepoDevCommand(pm: QaapPackageManager, script: string, packageName: string): string {
        if (pm === 'pnpm') {
            const quoted = packageName.replace(/'/g, `'\\''`);
            return `pnpm --filter '${quoted}' ${script}`;
        }
        return this.buildRunCommand(pm, script);
    }

    protected pickDevScript(scripts: Record<string, unknown>): string | undefined {
        const available = Object.keys(scripts).filter(k => typeof scripts[k] === 'string');
        for (const key of DEV_SCRIPT_PRIORITY) {
            if (available.includes(key)) {
                return key;
            }
        }
        return undefined;
    }

    protected guessFramework(pkg: PackageJsonShape): { kind: QaapProjectKind; expectedPort?: number } {
        const allDeps: Record<string, unknown> = {
            ...(pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}),
            ...(pkg.devDependencies && typeof pkg.devDependencies === 'object' ? pkg.devDependencies : {}),
        };
        const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
        const runnableScripts = DEV_SCRIPT_PRIORITY
            .map(name => scripts[name])
            .filter((value): value is string => typeof value === 'string');
        const scriptText = runnableScripts.join('\n');
        const explicitPortMatch = EXPLICIT_SCRIPT_PORT_REGEX.exec(scriptText);
        const explicitPort = explicitPortMatch ? Number(explicitPortMatch[1]) : undefined;
        const validExplicitPort = explicitPort !== undefined && explicitPort > 0 && explicitPort < 65536
            ? explicitPort
            : undefined;
        for (const [dep, kind, port] of FRAMEWORK_BY_DEP) {
            if (dep in allDeps) {
                return { kind, expectedPort: validExplicitPort ?? port };
            }
        }
        for (const [pattern, kind, port] of FRAMEWORK_BY_SCRIPT) {
            if (pattern.test(scriptText)) {
                return { kind, expectedPort: validExplicitPort ?? port };
            }
        }
        if (this.isJsonServerPackage(pkg, allDeps, scriptText)) {
            return { kind: 'node-generic', expectedPort: QAAP_THEIA_DEV_PORT };
        }
        if ('@theia/core' in allDeps || '@theia/cli' in allDeps) {
            return { kind: 'node-generic', expectedPort: QAAP_THEIA_DEV_PORT };
        }
        const start = scripts.start;
        if (typeof start === 'string' && /\btheia\s+start\b/.test(start)) {
            return { kind: 'node-generic', expectedPort: QAAP_THEIA_DEV_PORT };
        }
        return { kind: 'node-generic' };
    }

    protected isJsonServerPackage(
        pkg: PackageJsonShape,
        allDeps: Record<string, unknown>,
        scriptText: string,
    ): boolean {
        if (typeof pkg.name === 'string' && pkg.name.trim().toLowerCase() === 'json-server') {
            return true;
        }
        if ('json-server' in allDeps) {
            return true;
        }
        if (pkg.bin && typeof pkg.bin === 'object' && pkg.bin !== null && 'json-server' in pkg.bin) {
            return true;
        }
        return /\bjson-server\b/i.test(scriptText);
    }
}
