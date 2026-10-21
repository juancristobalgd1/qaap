// Tests for scripts/qaap-openrouter-free-model-health.mjs with a fake fetch (node --test, no network).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkModels, judgeEndpoints, main, parseDefaultFreeModels } from './qaap-openrouter-free-model-health.mjs';

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
    assert.deepEqual(judgeEndpoints('m', endpoints()), { id: 'm', healthy: false, summary: 'no endpoints' });
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
