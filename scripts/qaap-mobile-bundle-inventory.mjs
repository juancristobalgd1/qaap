#!/usr/bin/env node
/**
 * Source-level inventory for the browser app's frontend module graph.
 *
 * The generated Theia config (gen-webpack.config.js / src-gen) exists only after
 * `theia generate`, and a webpack stats file exists only after a build. This
 * analyzer reads webpack.config.js, package manifests, and TS/JS/CSS source so
 * the Work Hub / IDE split can be planned without compiling the application.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptDir);
const appRoot = path.join(repoRoot, 'examples', 'browser');
const appManifestPath = path.join(appRoot, 'package.json');
const webpackConfigPath = path.join(appRoot, 'webpack.config.js');
const appManifest = JSON.parse(fs.readFileSync(appManifestPath, 'utf8'));
const packageDirs = new Map();
const packageManifests = new Map();
const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css'];

function walkPackageManifests(directory) {
    if (!fs.existsSync(directory)) {
        return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) {
            continue;
        }
        const packageDir = path.join(directory, entry.name);
        const manifestPath = path.join(packageDir, 'package.json');
        if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                if (typeof manifest.name === 'string') {
                    packageDirs.set(manifest.name, packageDir);
                    packageManifests.set(manifest.name, manifest);
                }
            } catch {
                // Ignore malformed or generated package folders; they are not app inputs.
            }
        }
        walkPackageManifests(packageDir);
    }
}

walkPackageManifests(path.join(repoRoot, 'packages'));
walkPackageManifests(path.join(repoRoot, 'dev-packages'));

function packageNameFromSpecifier(specifier) {
    if (specifier.startsWith('@')) {
        return specifier.split('/').slice(0, 2).join('/');
    }
    return specifier.split('/')[0];
}

function resolveFile(candidate) {
    const possibilities = [candidate];
    for (const extension of sourceExtensions) {
        possibilities.push(candidate + extension);
    }
    for (const extension of sourceExtensions) {
        possibilities.push(path.join(candidate, 'index' + extension));
    }
    for (const possibility of possibilities) {
        if (fs.existsSync(possibility) && fs.statSync(possibility).isFile()) {
            return path.resolve(possibility);
        }
    }
    return undefined;
}

function resolveImport(specifier, importer) {
    const cleanSpecifier = specifier.replace(/\?qaap-lazy$/, '');
    if (cleanSpecifier.startsWith('.') || cleanSpecifier.startsWith('/')) {
        return resolveFile(path.resolve(path.dirname(importer), cleanSpecifier));
    }
    const packageName = packageNameFromSpecifier(cleanSpecifier);
    const packageDir = packageDirs.get(packageName);
    if (!packageDir) {
        return undefined;
    }
    const rest = cleanSpecifier.slice(packageName.length).replace(/^\//, '');
    const candidates = [];
    if (!rest) {
        candidates.push(path.join(packageDir, 'src', 'index'));
    } else if (rest.startsWith('lib/')) {
        candidates.push(path.join(packageDir, 'src', rest.slice('lib/'.length)));
        candidates.push(path.join(packageDir, rest));
    } else if (rest.startsWith('src/')) {
        candidates.push(path.join(packageDir, rest));
    } else {
        candidates.push(path.join(packageDir, 'src', rest));
        candidates.push(path.join(packageDir, rest));
    }
    for (const candidate of candidates) {
        const resolved = resolveFile(candidate);
        if (resolved) {
            return resolved;
        }
    }
    return undefined;
}

function importsIn(source) {
    const values = new Set();
    const patterns = [
        /\bimport\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g,
        /\bexport\s+[^'";]*?\s+from\s*['"]([^'"]+)['"]/g,
        /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    if (source.includes('@import')) {
        patterns.push(/@import\s+(?:url\()?['"]?([^'"\s)]+)['"]?\)?/g);
    }
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            const value = match[1];
            if (value && !value.startsWith('data:') && !value.startsWith('http:') && !value.startsWith('https:')) {
                values.add(value);
            }
        }
    }
    return [...values];
}

function analyzeGraph(roots) {
    const visited = new Set();
    const unresolved = new Set();
    const queue = roots.map(root => path.resolve(root)).filter(root => fs.existsSync(root));
    while (queue.length) {
        const file = queue.pop();
        if (visited.has(file)) {
            continue;
        }
        visited.add(file);
        let source;
        try {
            source = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        for (const specifier of importsIn(source)) {
            const resolved = resolveImport(specifier, file);
            if (resolved) {
                queue.push(resolved);
            } else if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
                unresolved.add(specifier);
            }
        }
    }
    return { files: visited, unresolved };
}

function packageDependencyClosure(initialPackages) {
    const packages = new Set();
    const queue = [...initialPackages];
    while (queue.length) {
        const packageName = queue.pop();
        if (packages.has(packageName)) {
            continue;
        }
        packages.add(packageName);
        const manifest = packageManifests.get(packageName);
        for (const dependency of Object.keys(manifest?.dependencies ?? {})) {
            if (packageManifests.has(dependency)) {
                queue.push(dependency);
            }
        }
    }
    return packages;
}

function frontendEntries(packages) {
    const entries = [];
    for (const packageName of packages) {
        const packageDir = packageDirs.get(packageName);
        const manifest = packageManifests.get(packageName);
        for (const extension of manifest?.theiaExtensions ?? []) {
            if (typeof extension?.frontend !== 'string') {
                continue;
            }
            const modulePath = extension.frontend.replace(/^lib\//, 'src/');
            const entry = resolveFile(path.join(packageDir, modulePath));
            if (entry) {
                entries.push(entry);
            }
        }
    }
    return [...new Set(entries)];
}

function displayPath(file) {
    return path.relative(repoRoot, file).replaceAll(path.sep, '/');
}

function sortedFileGroups(files) {
    const groups = new Map();
    for (const file of files) {
        const relative = displayPath(file);
        const packageMatch = relative.match(/^(packages\/[^/]+|dev-packages\/[^/]+)/);
        const group = packageMatch?.[1] ?? relative.split('/')[0];
        groups.set(group, (groups.get(group) ?? 0) + 1);
    }
    return [...groups].sort(([left], [right]) => left.localeCompare(right));
}

const appPackages = packageDependencyClosure(Object.keys(appManifest.dependencies ?? {}));
const appEntries = frontendEntries(appPackages);
const workHubEntry = path.join(repoRoot, 'packages/qaap-work-hub/src/browser/qaap-work-hub-frontend-module.ts');
const workbenchEntry = path.join(repoRoot, 'packages/qaap-work-hub/src/browser/qaap-workbench-frontend-module.ts');
const appGraph = analyzeGraph(appEntries);
const workHubGraph = analyzeGraph([workHubEntry]);
const workbenchGraph = analyzeGraph([workbenchEntry]);
const appCss = [...appGraph.files].filter(file => file.endsWith('.css'));
const workHubCss = [...workHubGraph.files].filter(file => file.endsWith('.css'));
const appOnly = [...appGraph.files].filter(file => !workHubGraph.files.has(file));
const workHubPackageClosure = packageDependencyClosure(['@theia/qaap-work-hub']);
const ideOnlyFrontendEntries = frontendEntries(appPackages).filter(entry => !workHubGraph.files.has(entry));
const ideEntryGraph = analyzeGraph(ideOnlyFrontendEntries);
const webpackText = fs.readFileSync(webpackConfigPath, 'utf8');

console.log('# Qaap mobile bundle source inventory');
console.log('');
console.log(`webpack config: ${displayPath(webpackConfigPath)}`);
console.log(`webpack generated config referenced: ${webpackText.includes("./gen-webpack.config.js") ? 'yes (configs[0])' : 'not detected'}`);
console.log('method: source-level import traversal from frontend extension manifests and Work Hub composition root; no webpack build or generated stats');
console.log(`browser app dependency packages discovered: ${appPackages.size}`);
console.log(`browser app frontend extension roots discovered: ${appEntries.length}`);
console.log(`Work Hub package dependency closure: ${workHubPackageClosure.size} packages`);
console.log('');
console.log('## Work Hub composition root (mobile surface and Work Hub-owned dependencies)');
console.log(`entry: ${displayPath(workHubEntry)}`);
console.log(`source files: ${workHubGraph.files.size}; CSS files: ${workHubCss.length}; unresolved imports: ${workHubGraph.unresolved.size}`);
for (const [group, count] of sortedFileGroups(workHubGraph.files)) {
    console.log(`- ${group}: ${count} files`);
}
console.log('');
console.log('## Shared browser application graph (all frontend extension roots from examples/browser dependencies)');
console.log(`source files: ${appGraph.files.size}; CSS files: ${appCss.length}; unresolved imports: ${appGraph.unresolved.size}`);
for (const [group, count] of sortedFileGroups(appGraph.files)) {
    console.log(`- ${group}: ${count} files`);
}
console.log('');
console.log('## App modules outside the Work Hub composition graph');
console.log(`extension roots outside Work Hub composition imports: ${ideOnlyFrontendEntries.length}`);
console.log(`reachable source files: ${appOnly.length}; CSS files: ${appOnly.filter(file => file.endsWith('.css')).length}`);
for (const [group, count] of sortedFileGroups(appOnly)) {
    console.log(`- ${group}: ${count} files`);
}
console.log('');
console.log('## CSS reachable from Work Hub composition root');
for (const file of workHubCss.sort()) {
    console.log(`- ${displayPath(file)}`);
}
console.log('');
console.log('## Module paths');
console.log('Work Hub reachable modules:');
for (const file of [...workHubGraph.files].sort()) {
    console.log(`- ${displayPath(file)}`);
}
console.log('Modules in the shared app graph outside the Work Hub graph:');
for (const file of appOnly.sort()) {
    console.log(`- ${displayPath(file)}`);
}
console.log('');
console.log('## Unresolved import summary (external deps or generated aliases not present in source workspace)');
const unresolvedImports = [...new Set([...appGraph.unresolved, ...workHubGraph.unresolved, ...ideEntryGraph.unresolved])]
    .filter(specifier => !specifier.startsWith('#') && !specifier.startsWith('$') && !specifier.startsWith('`'))
    .sort();
console.log(`${unresolvedImports.length} unique unresolved specifiers; examples: ${unresolvedImports.slice(0, 45).join(', ')}`);
if (unresolvedImports.length > 45) {
    console.log(`... ${unresolvedImports.length - 45} additional specifiers are omitted from this summary.`);
}
console.log('');
console.log('## Current production measurements (provided by owner)');
console.log('- bundle.js: 1.98 MB gzip / 7.8 MB uncompressed');
console.log('- bundle.css: 1.51 MB gzip');
console.log('- HTML: 6 KB; health endpoint: 0.4 s');
console.log('');
console.log('Caveat: this is a conservative static inventory, not webpack stats. It includes source imports reachable from the composition roots; loader transforms, tree-shaking, generated aliases, and webpack chunk placement require a later production build to verify.');
