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
//   ... --policy launch                                           judge the defaults as a fallback chain
// A model is healthy when at least one endpoint reports `status: 0` and supports `tools` (QAIQ is an
// agent: a model that cannot call tools is no use as a default). Exit 1 when a checked model is not
// healthy, 2 when the API could not be reached (inconclusive) or on a usage error.
//
// `--policy launch` (used by .github/workflows/qaap-openrouter-model-health.yml) exits 1 only when the
// HEAD of the default list (the env-fallback default) is dead, or fewer than 3 of the first 4
// (MAX_AGENT_MODEL_FALLBACK_ATTEMPTS) can be healthy; any other dead entry is a `::warning::`
// annotation. An unreachable API is inconclusive (warning), never "model dead". It also appends a
// table to $GITHUB_STEP_SUMMARY when that variable is set.
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://openrouter.ai/api/v1';
/** Size of the fallback chain window (MAX_AGENT_MODEL_FALLBACK_ATTEMPTS in qaap-agent-model-fallback.ts). */
const FALLBACK_WINDOW = 4;
const MIN_HEALTHY_IN_WINDOW = 3;
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
        return { id, healthy: false, summary: 'not in the OpenRouter catalog', endpoints: 0, tools: false, status: 'not in catalog' };
    }
    if (!endpoints.length) {
        return { id, healthy: false, summary: 'no endpoints', endpoints: 0, tools: false, status: 'no endpoints' };
    }
    const described = endpoints.map(endpoint => {
        const tools = Array.isArray(endpoint?.supported_parameters) && endpoint.supported_parameters.includes('tools');
        return { provider: endpoint?.provider_name ?? '?', status: endpoint?.status, tools, uptime: endpoint?.uptime_last_30m };
    });
    const healthy = described.some(endpoint => endpoint.status === 0 && endpoint.tools);
    const summary = described.map(endpoint => `${endpoint.provider} status=${endpoint.status ?? '?'}${endpoint.tools ? ' tools' : ' no-tools'}`
        + `${typeof endpoint.uptime === 'number' ? ` uptime30m=${Math.round(endpoint.uptime)}%` : ''}`).join(', ');
    const statuses = [...new Set(described.map(endpoint => endpoint.status ?? '?'))].join('/');
    // -1/-2 are transient (degraded/recovering) states seen on live endpoints; <= -3 (e.g. -5) is down.
    const degraded = !healthy && described.some(endpoint => (endpoint.status === -1 || endpoint.status === -2) && endpoint.tools);
    return { id, healthy, degraded, summary, endpoints: described.length, tools: described.some(endpoint => endpoint.tools), status: `status ${statuses}` };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** GET json; retries once on a network error, 5xx or 429. 404 resolves to `undefined`; other 4xx throw at once. */
async function fetchJson(fetchImpl, url, retryDelayMs = 2_000) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt) {
            await sleep(retryDelayMs);
        }
        let response;
        try {
            response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
        } catch (error) {
            lastError = error;
            continue;
        }
        if (response.status === 404) {
            return undefined;
        }
        if (!response.ok) {
            lastError = new Error(`${url} returned HTTP ${response.status}`);
            if (response.status >= 500 || response.status === 429) {
                continue;
            }
            throw lastError;
        }
        try {
            return await response.json();
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

/**
 * Checks each model id; resolves to one verdict per id, in order. A model whose lookup still fails
 * after the retry gets `inconclusive: true` (the API was unreachable: says nothing about the model).
 */
export async function checkModels(ids, fetchImpl = fetch, retryDelayMs = 2_000) {
    const verdicts = [];
    for (const id of ids) {
        try {
            const payload = await fetchJson(fetchImpl, `${API}/models/${id.split('/').map(encodeURIComponent).join('/')}/endpoints`, retryDelayMs);
            verdicts.push(judgeEndpoints(id, payload));
        } catch (error) {
            verdicts.push({ id, healthy: false, inconclusive: true, summary: `inconclusive: ${error?.message ?? error}`, endpoints: 0, tools: false, status: 'inconclusive' });
        }
    }
    return verdicts;
}

/**
 * Launch policy over the ordered default list: `failures` make the job red, `warnings` only annotate.
 * Inconclusive entries count as possibly healthy, so an API outage never fails the job.
 */
export function evaluateLaunchPolicy(verdicts) {
    const failures = [];
    const warnings = [];
    const head = verdicts[0];
    if (!head) {
        failures.push('No default models to check.');
    } else if (!head.inconclusive && !head.degraded && !head.healthy) {
        failures.push(`Default model ${head.id} (head of OPENROUTER_DEFAULT_FREE_MODELS) is unhealthy: ${head.summary}`);
    }
    const window = verdicts.slice(0, FALLBACK_WINDOW);
    const healthy = window.filter(verdict => verdict.healthy).length;
    const possible = window.filter(verdict => verdict.healthy || verdict.inconclusive || verdict.degraded).length;
    if (window.length && possible < MIN_HEALTHY_IN_WINDOW) {
        failures.push(`Only ${healthy} of the first ${window.length} defaults are healthy (need ${MIN_HEALTHY_IN_WINDOW}): the fallback chain is too thin.`);
    }
    for (const verdict of verdicts) {
        if (verdict.degraded) {
            warnings.push(`${verdict.id} is degraded (transient endpoint status -1/-2): ${verdict.summary}`);
        } else if (verdict.inconclusive) {
            warnings.push(`${verdict.id}: could not be checked (${verdict.summary}).`);
        } else if (!verdict.healthy && verdict !== head) {
            warnings.push(`${verdict.id} is unhealthy: ${verdict.summary}`);
        }
    }
    return { failures, warnings, healthy };
}

/** Markdown table for $GITHUB_STEP_SUMMARY. */
export function renderSummary(verdicts, result) {
    const cell = verdict => (verdict.inconclusive ? 'inconclusive' : verdict.degraded ? 'degraded' : verdict.healthy ? 'healthy' : 'UNHEALTHY');
    const rows = verdicts.map((verdict, index) => `| ${index + 1} | \`${verdict.id}\` | ${verdict.endpoints} | ${verdict.status} | ${cell(verdict)} | ${verdict.tools ? 'yes' : 'no'} |`);
    return [
        '## QAIQ default free models (OpenRouter)',
        '',
        '| # | Model | Provider endpoints | Endpoint status | Verdict | Tools |',
        '| - | - | - | - | - | - |',
        ...rows,
        '',
        `Healthy in the fallback window: ${result.healthy}/${Math.min(FALLBACK_WINDOW, verdicts.length)}. ${result.failures.length ? 'FAILED' : 'Passed'}.`,
        '',
        ...result.failures.map(failure => `- FAIL: ${failure}`),
        ...result.warnings.map(warning => `- warning: ${warning}`),
        ''
    ].join('\n');
}

/** Every `:free` model id in the public catalog. */
export async function listFreeModels(fetchImpl = fetch) {
    const catalog = await fetchJson(fetchImpl, `${API}/models`);
    return (Array.isArray(catalog?.data) ? catalog.data : [])
        .map(model => model?.id)
        .filter(id => typeof id === 'string' && id.endsWith(':free'));
}

export async function main(argv, fetchImpl = fetch, out = console.log, env = process.env, retryDelayMs = 2_000) {
    const policyIndex = argv.indexOf('--policy');
    const policy = policyIndex >= 0 ? argv[policyIndex + 1] : undefined;
    if (policyIndex >= 0 && policy !== 'launch') {
        out('Unknown --policy (supported: launch).');
        return 2;
    }
    const args = policyIndex >= 0 ? argv.filter((_, index) => index !== policyIndex && index !== policyIndex + 1) : argv;
    let ids;
    if (args.includes('--all')) {
        ids = await listFreeModels(fetchImpl);
    } else if (args.length) {
        ids = args;
    } else {
        ids = parseDefaultFreeModels(readFileSync(DEFAULTS_SOURCE, 'utf8'));
        if (!ids.length) {
            out(`Could not read OPENROUTER_DEFAULT_FREE_MODELS from ${DEFAULTS_SOURCE}.`);
            return 2;
        }
    }
    const verdicts = await checkModels(ids, fetchImpl, retryDelayMs);
    for (const verdict of verdicts) {
        out(`${verdict.inconclusive ? 'UNKN' : verdict.healthy ? 'OK  ' : 'DEAD'} ${verdict.id}: ${verdict.summary}`);
    }
    if (policy === 'launch') {
        const result = evaluateLaunchPolicy(verdicts);
        for (const warning of result.warnings) {
            out(`::warning title=OpenRouter free model::${warning}`);
        }
        for (const failure of result.failures) {
            out(`::error title=OpenRouter default model::${failure}`);
        }
        if (env.GITHUB_STEP_SUMMARY) {
            appendFileSync(env.GITHUB_STEP_SUMMARY, renderSummary(verdicts, result));
        }
        return result.failures.length ? 1 : 0;
    }
    if (verdicts.some(verdict => !verdict.healthy && !verdict.inconclusive)) {
        return 1;
    }
    return verdicts.some(verdict => verdict.inconclusive) ? 2 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    }, error => {
        console.error(`OpenRouter health check failed: ${error?.message ?? error}`);
        process.exitCode = 2;
    });
}
