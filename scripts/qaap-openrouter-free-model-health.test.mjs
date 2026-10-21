// Tests for scripts/qaap-openrouter-free-model-health.mjs with a fake fetch (node --test, no network).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkModels, evaluateLaunchPolicy, judgeEndpoints, main, parseDefaultFreeModels } from './qaap-openrouter-free-model-health.mjs';

const endpoints = (...list) => ({ data: { endpoints: list } });
const live = { provider_name: 'Nvidia', status: 0, supported_parameters: ['tools'], uptime_last_30m: 100 };

test('reads the curated defaults from openrouter-models.ts, comments ignored', () => {
    const ids = parseDefaultFreeModels(readFileSync(new URL('../packages/qaap-ai-openrouter/src/common/openrouter-models.ts', import.meta.url), 'utf8'));
    assert.equal(ids[0], 'nvidia/nemotron-3-ultra-550b-a55b:free');
    assert.ok(!ids.includes('nvidia/nemotron-3-super-120b-a12b:free'));
    assert.ok(ids.length >= 3);
    assert.deepEqual(parseDefaultFreeModels(`x = [\n  // 'commented/out:free',\n  'a/b:free', // 'c/d:free'\n];`), []);
    assert.deepEqual(parseDefaultFreeModels(`OPENROUTER_DEFAULT_FREE_MODELS = [\n  // 'commented/out:free'\n  'a/b:free', // 'c/d:free'\n];`), ['a/b:free']);
});

test('healthy only with a live endpoint that supports tools', () => {
    assert.equal(judgeEndpoints('m', endpoints(live)).healthy, true);
    // Oct 21 2026: the old default's only endpoint.
    const dead = judgeEndpoints('nvidia/nemotron-3-super-120b-a12b:free', endpoints({ ...live, status: -5, uptime_last_30m: 0 }));
    assert.equal(dead.healthy, false);
    assert.match(dead.summary, /Nvidia status=-5 tools uptime30m=0%/);
    assert.equal(judgeEndpoints('m', endpoints({ ...live, supported_parameters: [] })).healthy, false);
    assert.deepEqual(judgeEndpoints('m', endpoints()), { id: 'm', healthy: false, summary: 'no endpoints', endpoints: 0, tools: false, status: 'no endpoints' });
    assert.equal(judgeEndpoints('m', undefined).summary, 'not in the OpenRouter catalog');
});

test('checks each model on its own endpoints URL and exits 1 when one is dead', async () => {
    const urls = [];
    const fakeFetch = async url => {
        urls.push(url);
        if (url.includes('missing')) {
            return { status: 404, ok: false, json: async () => ({}) };
        }
        const status = url.includes('dead') ? -5 : 0;
        return { status: 200, ok: true, json: async () => endpoints({ ...live, status }) };
    };
    const verdicts = await checkModels(['org/live:free', 'org/dead:free'], fakeFetch);
    assert.deepEqual(verdicts.map(verdict => verdict.healthy), [true, false]);
    assert.equal(urls[0], 'https://openrouter.ai/api/v1/models/org/live%3Afree/endpoints');
    const lines = [];
    assert.equal(await main(['org/live:free'], fakeFetch, line => lines.push(line)), 0);
    assert.equal(await main(['org/live:free', 'org/missing:free'], fakeFetch, line => lines.push(line)), 1);
    assert.ok(lines.some(line => line.startsWith('DEAD org/missing:free: not in the OpenRouter catalog')), lines.join('\n'));
});

const verdict = (id, state) => ({ id, healthy: state === 'ok', inconclusive: state === 'unknown', summary: state, endpoints: 1, tools: true, status: state });

test('launch policy: dead head fails, thin window fails, other dead entries only warn', () => {
    const ok = evaluateLaunchPolicy(['a', 'b', 'c', 'd', 'e'].map(id => verdict(id, 'ok')));
    assert.deepEqual([ok.failures, ok.warnings], [[], []]);
    assert.equal(evaluateLaunchPolicy([verdict('a', 'dead'), ...['b', 'c', 'd'].map(id => verdict(id, 'ok'))]).failures.length, 1);
    const tailDead = evaluateLaunchPolicy([verdict('a', 'ok'), verdict('b', 'ok'), verdict('c', 'ok'), verdict('d', 'dead'), verdict('e', 'dead')]);
    assert.deepEqual(tailDead.failures, []);
    assert.equal(tailDead.warnings.length, 2);
    const thin = evaluateLaunchPolicy([verdict('a', 'ok'), verdict('b', 'ok'), verdict('c', 'dead'), verdict('d', 'dead'), verdict('e', 'ok')]);
    assert.match(thin.failures.join(), /Only 2 of the first 4/);
});

test('launch policy: inconclusive (API down) is a warning, never a failure', () => {
    const result = evaluateLaunchPolicy(['a', 'b', 'c', 'd'].map(id => verdict(id, 'unknown')));
    assert.deepEqual(result.failures, []);
    assert.equal(result.warnings.length, 4);
});

test('retries once on a network error or 5xx, then reports inconclusive instead of dead', async () => {
    let calls = 0;
    const flaky = async () => {
        calls++;
        if (calls === 1) {
            throw new TypeError('fetch failed');
        }
        return { status: 200, ok: true, json: async () => endpoints(live) };
    };
    assert.equal((await checkModels(['org/a:free'], flaky, 0))[0].healthy, true);
    assert.equal(calls, 2);
    calls = 0;
    const down = async () => {
        calls++;
        return { status: 503, ok: false, json: async () => ({}) };
    };
    const [result] = await checkModels(['org/a:free'], down, 0);
    assert.equal(result.inconclusive, true);
    assert.equal(calls, 2);
    // A 404 is a real answer (model gone): no retry.
    calls = 0;
    const gone = async () => {
        calls++;
        return { status: 404, ok: false, json: async () => ({}) };
    };
    assert.equal((await checkModels(['org/a:free'], gone, 0))[0].healthy, false);
    assert.equal(calls, 1);
});

test('main --policy launch emits annotations, writes the summary and maps to exit codes', async () => {
    const summary = join(mkdtempSync(join(tmpdir(), 'orhealth-')), 'summary.md');
    const lines = [];
    const fake = async url => ({ status: 200, ok: true, json: async () => endpoints({ ...live, status: url.includes('bad') ? -5 : 0 }) });
    assert.equal(await main(['--policy', 'launch', 'o/a:free', 'o/b:free', 'o/c:free', 'o/bad:free'], fake, line => lines.push(line), { GITHUB_STEP_SUMMARY: summary }, 0), 0);
    assert.ok(lines.some(line => line.startsWith('::warning') && line.includes('o/bad:free')), lines.join('\n'));
    assert.match(readFileSync(summary, 'utf8'), /\| 4 \| `o\/bad:free` \| 1 \| status -5 \| UNHEALTHY \| yes \|/);
    assert.equal(await main(['--policy', 'launch', 'o/bad:free', 'o/a:free', 'o/b:free', 'o/c:free'], fake, () => undefined, {}, 0), 1);
    const down = async () => ({ status: 500, ok: false, json: async () => ({}) });
    assert.equal(await main(['--policy', 'launch', 'o/a:free', 'o/b:free', 'o/c:free', 'o/d:free'], down, () => undefined, {}, 0), 0);
    assert.equal(await main(['o/a:free'], down, () => undefined, {}, 0), 2);
    assert.equal(await main(['--policy', 'nope'], fake, () => undefined, {}, 0), 2);
});
