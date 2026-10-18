#!/usr/bin/env node
// Validates the real-GitHub assumptions behind task pull requests (doc/qaap-task-to-pr.md) against a
// PRIVATE scratch repository, through the `gh` CLI only: this script never reads or holds a token
// (git authenticates with `gh auth git-credential`, API calls go through `gh api`).
//
//   (i)   GitHub accepts a push of a commit carrying a PNG to a non-branch ref, refs/qaap/evidence/<x>;
//   (ii)  the file at that commit is served (`gh api …/contents?ref=<sha>` with the raw media type), and
//         the https://github.com/<o>/<r>/raw/<sha>/<file> link the PR body uses resolves for the
//         signed-in user (checked through `gh api` against the same blob; the anonymous status of the
//         raw URL is printed for information: a private repository answers 404 to anonymous clients);
//   (iii) a PR opened from a test branch can be converted to draft and back with the same GraphQL
//         mutations the service uses (convertPullRequestToDraft / markPullRequestReadyForReview), and
//         labelled `qaap: needs attention`; then the PR is closed and every ref it created is deleted.
//
// Usage: node scripts/qaap-task-pr-github-validate.mjs --repo owner/name [--keep]
// Needs: `gh auth status` signed in with `repo` scope, and git. Prints PASS/FAIL per step.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LABEL = 'qaap: needs attention';
// 1×1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

function parseArgs(argv) {
    const options = { repo: '', keep: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--repo') { options.repo = argv[++i] ?? ''; }
        else if (argv[i] === '--keep') { options.keep = true; }
        else { throw new Error(`Unknown option ${argv[i]}`); }
    }
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(options.repo)) {
        throw new Error('--repo owner/name is required');
    }
    return options;
}

function run(command, args, options = {}) {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();
}

function gh(args, input) {
    return run('gh', args, input === undefined ? {} : { input });
}

function ghJson(args, input) {
    const output = gh(args, input);
    return output ? JSON.parse(output) : undefined;
}

/** git that authenticates through gh, with no global/system config. */
function git(cwd, args) {
    return run('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', ...args], {
        cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
    });
}

const results = [];
async function step(name, body) {
    try {
        const detail = await body();
        results.push([true, name]);
        console.log(`PASS  ${name}${detail ? ` (${detail})` : ''}`);
        return true;
    } catch (error) {
        results.push([false, name]);
        console.log(`FAIL  ${name}: ${(error?.stderr || error?.message || String(error)).toString().trim().split('\n').slice(-3).join(' | ')}`);
        return false;
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const [owner, name] = options.repo.split('/');
    const stamp = `${Date.now()}`;
    const evidenceRef = `refs/qaap/evidence/validate-${stamp}`;
    const branch = `qaap/validate-${stamp}`;
    const url = `https://github.com/${owner}/${name}.git`;
    const work = mkdtempSync(join(tmpdir(), 'qaap-task-pr-validate-'));
    const cleanup = [];
    let evidenceSha = '';
    let pull;
    let labelExisted = true;

    await step('gh is signed in and the repository is private', async () => {
        gh(['auth', 'status']);
        const repo = ghJson(['api', `repos/${owner}/${name}`]);
        if (!repo.private) {
            throw new Error('use a PRIVATE scratch repository');
        }
        return `default branch ${repo.default_branch}`;
    });

    await step(`(i) push a PNG commit to ${evidenceRef}`, async () => {
        const gitDir = join(work, 'evidence.git');
        run('git', ['init', '--bare', '--quiet', gitDir]);
        const pngPath = join(work, 'validate.png');
        writeFileSync(pngPath, PNG);
        const index = join(work, 'evidence.index');
        const env = { ...process.env, GIT_INDEX_FILE: index, GIT_CONFIG_NOSYSTEM: '1' };
        const blob = run('git', ['--git-dir', gitDir, 'hash-object', '-w', pngPath]);
        run('git', ['--git-dir', gitDir, 'update-index', '--add', '--cacheinfo', `100644,${blob},screenshots/validate.png`], { env });
        const tree = run('git', ['--git-dir', gitDir, 'write-tree'], { env });
        evidenceSha = run('git', ['--git-dir', gitDir, '-c', 'user.name=Qaap', '-c', 'user.email=qaap@local', 'commit-tree', tree, '-m', 'Qaap evidence validation'], { env });
        git(work, ['--git-dir', gitDir, 'push', '--porcelain', url, `${evidenceSha}:${evidenceRef}`]);
        cleanup.push(() => gh(['api', '-X', 'DELETE', `repos/${owner}/${name}/git/refs/${evidenceRef.slice('refs/'.length)}`]));
        const listed = git(work, ['--git-dir', gitDir, 'ls-remote', url, evidenceRef]);
        if (!listed.startsWith(evidenceSha)) {
            throw new Error(`ls-remote shows "${listed}"`);
        }
        return evidenceSha.slice(0, 12);
    });

    await step('(ii) the screenshot is served at that commit (raw link target)', async () => {
        if (!evidenceSha) {
            throw new Error('no evidence commit');
        }
        const raw = execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw',
            `repos/${owner}/${name}/contents/screenshots/validate.png?ref=${evidenceSha}`], { stdio: ['ignore', 'pipe', 'pipe'] });
        if (!Buffer.from(raw).equals(PNG)) {
            throw new Error(`served ${raw.length} bytes, expected the ${PNG.length}-byte PNG`);
        }
        const rawUrl = `https://github.com/${owner}/${name}/raw/${evidenceSha}/screenshots/validate.png`;
        const anonymous = await fetch(rawUrl, { method: 'HEAD', redirect: 'manual' }).then(response => response.status).catch(() => 'network error');
        return `${rawUrl} anonymous status ${anonymous}`;
    });

    await step('(iii) open a PR from a test branch', async () => {
        const repo = ghJson(['api', `repos/${owner}/${name}`]);
        const base = repo.default_branch;
        const baseSha = ghJson(['api', `repos/${owner}/${name}/git/ref/heads/${base}`]).object.sha;
        const baseTree = ghJson(['api', `repos/${owner}/${name}/git/commits/${baseSha}`]).tree.sha;
        const blob = ghJson(['api', '-X', 'POST', `repos/${owner}/${name}/git/blobs`, '-f', `content=qaap validate ${stamp}\n`, '-f', 'encoding=utf-8']).sha;
        const tree = ghJson(['api', '-X', 'POST', `repos/${owner}/${name}/git/trees`, '--input', '-'],
            JSON.stringify({ base_tree: baseTree, tree: [{ path: `qaap-validate-${stamp}.txt`, mode: '100644', type: 'blob', sha: blob }] })).sha;
        const commit = ghJson(['api', '-X', 'POST', `repos/${owner}/${name}/git/commits`, '--input', '-'],
            JSON.stringify({ message: 'Qaap task: validation', tree, parents: [baseSha] })).sha;
        ghJson(['api', '-X', 'POST', `repos/${owner}/${name}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${commit}`]);
        cleanup.push(() => gh(['api', '-X', 'DELETE', `repos/${owner}/${name}/git/refs/heads/${branch}`]));
        pull = ghJson(['api', '-X', 'POST', `repos/${owner}/${name}/pulls`, '--input', '-'], JSON.stringify({
            title: '[qaap validate] task PR assumptions', head: branch, base,
            body: `<!-- qaap:evidence -->\nValidation run ${stamp}\n\n![Preview](https://github.com/${owner}/${name}/raw/${evidenceSha}/screenshots/validate.png)\n<!-- /qaap:evidence -->`,
        }));
        cleanup.unshift(() => gh(['api', '-X', 'PATCH', `repos/${owner}/${name}/pulls/${pull.number}`, '-f', 'state=closed']));
        return `#${pull.number}`;
    });

    await step('(iii) convertPullRequestToDraft makes it a draft', async () => {
        const data = ghJson(['api', 'graphql', '-f',
            'query=mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { isDraft } } }', '-f', `id=${pull.node_id}`]);
        if (data?.data?.convertPullRequestToDraft?.pullRequest?.isDraft !== true) {
            throw new Error(JSON.stringify(data));
        }
    });

    await step('(iii) markPullRequestReadyForReview makes it ready again', async () => {
        const data = ghJson(['api', 'graphql', '-f',
            'query=mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }', '-f', `id=${pull.node_id}`]);
        if (data?.data?.markPullRequestReadyForReview?.pullRequest?.isDraft !== false) {
            throw new Error(JSON.stringify(data));
        }
    });

    await step(`(iii) add the "${LABEL}" label`, async () => {
        try {
            gh(['api', `repos/${owner}/${name}/labels/${encodeURIComponent(LABEL)}`]);
        } catch {
            labelExisted = false;
        }
        const labels = ghJson(['api', '-X', 'POST', `repos/${owner}/${name}/issues/${pull.number}/labels`, '--input', '-'], JSON.stringify({ labels: [LABEL] }));
        if (!labels.some(label => label.name === LABEL)) {
            throw new Error(JSON.stringify(labels));
        }
        if (!labelExisted) {
            cleanup.push(() => gh(['api', '-X', 'DELETE', `repos/${owner}/${name}/labels/${encodeURIComponent(LABEL)}`]));
        }
    });

    if (!options.keep) {
        await step('cleanup: close the PR and delete the refs it created', async () => {
            const failures = [];
            for (const action of cleanup) {
                try {
                    action();
                } catch (error) {
                    failures.push((error?.stderr || error?.message || String(error)).toString().trim());
                }
            }
            if (failures.length) {
                throw new Error(failures.join(' | '));
            }
        });
    } else {
        console.log(`kept: PR #${pull?.number ?? '?'}, ${branch}, ${evidenceRef}`);
    }
    rmSync(work, { recursive: true, force: true });
    return results.every(([passed]) => passed) ? 0 : 1;
}

main().then(code => { process.exitCode = code; }, error => {
    console.error(`FAIL  ${error?.message ?? error}`);
    process.exitCode = 1;
});
