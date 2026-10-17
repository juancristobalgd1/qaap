import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export { assert };

/** Run the workspace's own public test-suite (`node --test`); the oracle requires it to stay green. */
export function runPublicTests(workspace, env = {}) {
    const result = spawnSync(process.execPath, ['--test'], {
        cwd: workspace,
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 120_000,
    });
    if (result.status !== 0) {
        throw new Error(`public tests failed (exit ${result.status})\n${result.stdout}\n${result.stderr}`);
    }
}

export function load(workspace, relative) {
    return import(pathToFileURL(path.join(workspace, relative)).href);
}

export function readSources(workspace, directory = 'src') {
    const root = path.join(workspace, directory);
    if (!fs.existsSync(root)) {
        return [];
    }
    return fs.readdirSync(root)
        .filter(name => name.endsWith('.js') || name.endsWith('.mjs'))
        .map(name => ({ name, text: fs.readFileSync(path.join(root, name), 'utf8') }));
}

/**
 * Oracle entry point: the public tests must pass AND the hidden behaviour checks must pass.
 * Any thrown error fails the oracle with exit code 1.
 */
export async function oracle(workspace, body, { publicTestsEnv } = {}) {
    try {
        runPublicTests(workspace, publicTestsEnv);
        await body({
            workspace,
            load: relative => load(workspace, relative),
            readSources: directory => readSources(workspace, directory),
        });
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
