#!/usr/bin/env node
// Health of OpenRouter `:free` models, from OpenRouter's public API (no key needed).
//
// Oct 21 2026: QAIQ's default `nvidia/nemotron-3-super-120b-a12b:free` stayed in the catalog while
// its only endpoint (Nvidia) sat at `status: -5` and answered 404, so every default turn burnt a
// failed attempt. The catalog alone does not show that; each model's `/endpoints` does.
//
// Usage:
//   node scripts/qaap-openrouter-free-model-health.mjs            check OPENROUTER_DEFAULT_FREE_MODELS
//   node scripts/qaap-openrouter-free-model-health.mjs <id> ...   check these model ids
//   node scripts/qaap-openrouter-free-model-health.mjs --all      every `:free` model in the catalog
// A model is healthy when at least one endpoint reports `status: 0` and supports `tools` (QAIQ is an
// agent: a model that cannot call tools is no use as a default). Exit 1 when a checked model is not
// healthy, 2 on a usage or network error. Needs network: not wired into CI.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://openrouter.ai/api/v1';
const DEFAULTS_SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'qaap-ai-openrouter', 'src', 'common', 'openrouter-models.ts');

/** The slugs of `OPENROUTER_DEFAULT_FREE_MODELS` in openrouter-models.ts, in order. */
export function parseDefaultFreeModels(source) {
    const start = source.indexOf('OPENROUTER_DEFAULT_FREE_MODELS');
    if (start < 0) {
        return [];
    }
    const open = source.indexOf('[', start);
    const close = source.indexOf('];', open);
    if (open < 0 || close < 0) {
        return [];
    }
    const body = source.slice(open + 1, close).split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
    return [...body.matchAll(/'([^']+)'/g)].map(match => match[1]);
}

/** Verdict for one model from its `/endpoints` payload (`undefined` = model unknown to OpenRouter). */
export function judgeEndpoints(id, payload) {
    const endpoints = Array.isArray(payload?.data?.endpoints) ? payload.data.endpoints : undefined;
    if (!endpoints) {
        return { id, healthy: false, summary: 'not in the OpenRouter catalog' };
    }
    if (!endpoints.length) {
        return { id, healthy: false, summary: 'no endpoints' };
    }
    const described = endpoints.map(endpoint => {
        const tools = Array.isArray(endpoint?.supported_parameters) && endpoint.supported_parameters.includes('tools');
        return { provider: endpoint?.provider_name ?? '?', status: endpoint?.status, tools, uptime: endpoint?.uptime_last_30m };
    });
    const healthy = described.some(endpoint => endpoint.status === 0 && endpoint.tools);
    const summary = described.map(endpoint => `${endpoint.provider} status=${endpoint.status ?? '?'}${endpoint.tools ? ' tools' : ' no-tools'}`
        + `${typeof endpoint.uptime === 'number' ? ` uptime30m=${Math.round(endpoint.uptime)}%` : ''}`).join(', ');
    return { id, healthy, summary };
}

async function fetchJson(fetchImpl, url) {
    const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (response.status === 404) {
        return undefined;
    }
    if (!response.ok) {
        throw new Error(`${url} returned HTTP ${response.status}`);
    }
    return response.json();
}

/** Checks each model id; resolves to one verdict per id, in order. */
export async function checkModels(ids, fetchImpl = fetch) {
    const verdicts = [];
    for (const id of ids) {
        const payload = await fetchJson(fetchImpl, `${API}/models/${id.split('/').map(encodeURIComponent).join('/')}/endpoints`);
        verdicts.push(judgeEndpoints(id, payload));
    }
    return verdicts;
}

/** Every `:free` model id in the public catalog. */
export async function listFreeModels(fetchImpl = fetch) {
    const catalog = await fetchJson(fetchImpl, `${API}/models`);
    return (Array.isArray(catalog?.data) ? catalog.data : [])
        .map(model => model?.id)
        .filter(id => typeof id === 'string' && id.endsWith(':free'));
}

export async function main(argv, fetchImpl = fetch, out = console.log) {
    let ids;
    if (argv.includes('--all')) {
        ids = await listFreeModels(fetchImpl);
    } else if (argv.length) {
        ids = argv;
    } else {
        ids = parseDefaultFreeModels(readFileSync(DEFAULTS_SOURCE, 'utf8'));
        if (!ids.length) {
            out(`Could not read OPENROUTER_DEFAULT_FREE_MODELS from ${DEFAULTS_SOURCE}.`);
            return 2;
        }
    }
    const verdicts = await checkModels(ids, fetchImpl);
    for (const verdict of verdicts) {
        out(`${verdict.healthy ? 'OK  ' : 'DEAD'} ${verdict.id}: ${verdict.summary}`);
    }
    return verdicts.every(verdict => verdict.healthy) ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    }, error => {
        console.error(`OpenRouter health check failed: ${error?.message ?? error}`);
        process.exitCode = 2;
    });
}
