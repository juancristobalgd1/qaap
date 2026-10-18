#!/usr/bin/env node
// Transcript scroll performance harness (roadmap H4.2): does the Work Hub transcript scroll at 60 fps
// on a mid-range phone while an agent turn streams?
//
// Starts the built browser backend (examples/browser/lib/backend/main.js) in skip-auth local mode with
// an isolated HOME and a fake `qaiq` (scripts/qaap-transcript-scroll-perf-fake-qaiq.mjs) that streams one
// long markdown answer through the real SSE → patch → markdown-tail path. Chromium opens the app at the
// mobile preset (375×812, touch, DPR 3) with CPU throttling (4× by default, Lighthouse's mid-range phone),
// sends the prompt from the sticky composer and, while the turn streams, measures three phases:
//
//   follow  - the reader stays glued to the live edge (no input).
//   scroll  - the reader scrolls up through the transcript with wheel gestures, ~one per 120 ms.
//   hold    - the reader rests detached, mid-transcript, while the tail keeps growing below.
//
// Per phase it reports rAF frame times (fps, p50/p95/p99, frames over 1.5×16.7 ms), long tasks,
// transcript scrollTop/scrollTo/scrollBy/scrollIntoView writes by the app (with the writing function
// taken from the stack), the drift of the row the reader is looking at (hold phase: anything but 0 is
// the "goes up and down" jank) and the transcript render metrics (`__QAAP_TRANSCRIPT_RENDER_METRICS__`).
//
// Usage: node scripts/qaap-transcript-scroll-perf.mjs [--port 3477] [--cpu 4] [--stream-ms 90000] [--phase-ms 10000]
//        [--out result.json] [--runs 1] [--profile] [--trace] [--headed] [--keep] [--serve]   (needs `npm run build:browser`)
//
//   --profile   CPU profile per phase: top self-time functions (and <phase>.cpuprofile with --keep).
//   --trace     main-thread trace per phase: time by event (UpdateLayoutTree, Layout, Paint, FunctionCall…).
//   --serve     only start the backend + fake agent and print the URL, to drive it by hand.
//   QAAP_PERF_INVALIDATIONS=1  with --trace: what invalidates style (reason, selector, node).
//   QAAP_PERF_STRIP_RULES=<re> delete the CSS rules whose selector matches, to price them.
//   QAAP_PERF_DEBUG=1          print server/DOM/render-metric state every 4 s and dump the live row.
// Runs where the answer did not paint live (the transcript only overflows at the end of the
// turn) measure an idle page: compare the "overflowed 3 screens after" time across runs.
import { spawn, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = resolve(import.meta.dirname, '..');
const BACKEND = join(ROOT, 'examples/browser/lib/backend/main.js');
const FAKE_QAIQ = join(ROOT, 'scripts/qaap-transcript-scroll-perf-fake-qaiq.mjs');
const TRANSCRIPT = '.theia-mobile-agent-transcript';

function parseArgs(argv) {
    const options = { port: 3477, cpu: 4, streamMs: 90_000, phaseMs: 10_000, out: undefined, runs: 1, headed: false, keep: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--port') { options.port = Number(argv[++i]); }
        else if (arg === '--cpu') { options.cpu = Number(argv[++i]); }
        else if (arg === '--stream-ms') { options.streamMs = Number(argv[++i]); }
        else if (arg === '--phase-ms') { options.phaseMs = Number(argv[++i]); }
        else if (arg === '--out') { options.out = resolve(argv[++i]); }
        else if (arg === '--runs') { options.runs = Number(argv[++i]); }
        else if (arg === '--headed') { options.headed = true; }
        else if (arg === '--keep') { options.keep = true; }
        else if (arg === '--serve') { options.serve = true; }
        else if (arg === '--profile') { options.profile = true; }
        else if (arg === '--trace') { options.trace = true; }
        else { throw new Error(`Unknown option ${arg}`); }
    }
    return options;
}

const sleep = ms => new Promise(done => setTimeout(done, ms));

async function waitFor(what, timeoutMs, probe) {
    const started = Date.now();
    for (;;) {
        const value = await probe().catch(() => undefined);
        if (value) {
            return value;
        }
        if (Date.now() - started > timeoutMs) {
            throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}`);
        }
        await sleep(250);
    }
}

/** Runs in the page before any app script: spies on transcript scroll writes and samples frames. */
function installPageProbe(transcriptSelector) {
    const transcriptClass = transcriptSelector.slice(1);
    const probe = {
        phase: 'idle',
        phases: {},
        userScrollUntil: 0,
    };
    const phaseState = () => {
        let state = probe.phases[probe.phase];
        if (!state) {
            state = probe.phases[probe.phase] = {
                frames: [], longTasks: [], writes: {}, writeCount: 0, noopWriteCount: 0, anchorDrift: [], startedAt: performance.now(),
                startGeometry: probe.geometry ? probe.geometry() : undefined,
            };
        }
        return state;
    };
    const writerName = () => {
        const stack = (new Error().stack || '').split('\n').slice(3);
        for (const line of stack) {
            const match = /at (?:[\w$.]+\.)?([\w$]+) /.exec(line);
            if (match && !/^(set|scrollTo|scrollBy|scrollIntoView|Object|HTMLElement|Element)$/.test(match[1])) {
                return match[1];
            }
        }
        return 'unknown';
    };
    const record = (element, kind, nextTop) => {
        if (!(element instanceof Element) || !element.classList.contains(transcriptClass)) {
            return;
        }
        const state = phaseState();
        const key = `${kind}:${writerName()}`;
        state.writes[key] = (state.writes[key] || 0) + 1;
        state.writeCount++;
        if (typeof nextTop === 'number' && Math.abs(nextTop - element.scrollTop) < 1) {
            state.noopWriteCount++;
        }
    };
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(Element.prototype, 'scrollTop', {
        configurable: true,
        get() { return descriptor.get.call(this); },
        set(value) { record(this, 'scrollTop', Number(value)); descriptor.set.call(this, value); },
    });
    for (const name of ['scrollTo', 'scrollBy']) {
        const original = Element.prototype[name];
        Element.prototype[name] = function (...args) {
            const top = typeof args[0] === 'object' && args[0] ? args[0].top : args[1];
            record(this, name, name === 'scrollTo' && typeof top === 'number' ? top : undefined);
            return original.apply(this, args);
        };
    }
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
        const scroller = this.closest && this.closest(transcriptSelector);
        if (scroller) {
            record(scroller, 'scrollIntoView');
        }
        return scrollIntoView.apply(this, args);
    };

    let last = 0;
    let anchor;
    const frame = now => {
        if (last) {
            phaseState().frames.push(now - last);
        }
        last = now;
        if (probe.phase === 'hold' && anchor) {
            const top = anchor.element.isConnected ? anchor.element.getBoundingClientRect().top : NaN;
            phaseState().anchorDrift.push(top - anchor.top);
        }
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                phaseState().longTasks.push(Math.round(entry.duration));
            }
        }).observe({ type: 'longtask' });
    }

    // Hidden surfaces keep their own transcript elements: measure the one on screen.
    probe.scroller = () => [...document.querySelectorAll(transcriptSelector)]
        .find(element => element.clientHeight > 0 && element.getClientRects().length > 0);
    probe.geometry = () => {
        const scroller = probe.scroller();
        return scroller ? {
            top: Math.round(scroller.scrollTop), height: scroller.scrollHeight, client: scroller.clientHeight,
            count: document.querySelectorAll(transcriptSelector).length,
            streaming: document.querySelectorAll('[data-transcript-message-id]').length,
        } : undefined;
    };
    probe.setPhase = name => {
        if (probe.phases[probe.phase]) {
            probe.phases[probe.phase].endGeometry = probe.geometry();
        }
        probe.phase = name;
        last = 0;
        phaseState();
        anchor = undefined;
        if (name === 'hold') {
            const scroller = probe.scroller();
            if (scroller) {
                const box = scroller.getBoundingClientRect();
                const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                if (hit) {
                    anchor = { element: hit, top: hit.getBoundingClientRect().top };
                }
            }
        }
    };
    probe.enableRenderMetrics = () => {
        const key = '__QAAP_TRANSCRIPT_RENDER_METRICS__';
        const zero = () => new Proxy({}, { get: (target, property) => target[property] ?? 0 });
        const store = globalThis[key];
        if (store) {
            store.enabled = true;
            for (const metric of Object.keys(store.counts)) {
                store.counts[metric] = 0;
            }
        } else {
            globalThis[key] = { enabled: true, counts: zero() };
        }
    };
    probe.trace = [];
    probe.installTrace = () => {
        const store = globalThis.__QAAP_TRANSCRIPT_RENDER_METRICS__;
        const ids = new WeakMap();
        let next = 1;
        const tag = node => { if (!node || typeof node !== 'object') { return 'nil'; } if (!ids.has(node)) { ids.set(node, next++); } return `#${ids.get(node)}${node.isConnected ? '' : '(det)'}`; };
        probe.tag = tag;
        const push = line => { probe.trace.push(`${Math.round(performance.now())} ${line}`); if (probe.trace.length > 4000) { probe.trace.shift(); } };
        Error.stackTraceLimit = 60;
        const raw = store.counts;
        store.counts = new Proxy(raw, { set: (target, property, value) => { target[property] = value;
            if (/render_|sse_flushed/.test(String(property))) { push(`M ${String(property)}`); }
            if (/append_missing_row|last_agent_in_place|render_patch_append$/.test(String(property)) && (probe.stacks = probe.stacks || {})[property] === undefined) {
                probe.stacks[property] = new Error().stack.split('\n').slice(2, 60).map(l => l.trim().replace(/\(?http[^ ]*\/([^/]+)\)?$/, '$1')).join('\n'); push(`S ${String(property)}\n${probe.stacks[property]}`); }
            return true; } });
        const isRow = node => node instanceof Element && (node.hasAttribute('data-transcript-message-id') || !!node.querySelector?.('[data-transcript-message-id]'));
        for (const [proto, name] of [[Node.prototype, 'insertBefore'], [Node.prototype, 'appendChild'], [Node.prototype, 'replaceChild'], [Element.prototype, 'append'], [Element.prototype, 'replaceChildren'], [Element.prototype, 'replaceWith'], [Element.prototype, 'remove']]) {
            const original = proto[name];
            proto[name] = function (...args) {
                const rowArgs = args.filter(isRow);
                const self = name === 'replaceWith' || name === 'remove';
                if ((self && isRow(this)) || rowArgs.length || (name === 'replaceChildren' && this.querySelector?.('[data-transcript-message-id]'))) {
                    push(`D ${name} this=${String(this.className).split(' ')[0]}${tag(this)} parent=${tag(this.parentElement)} rows=${rowArgs.map(r => `${r.dataset?.transcriptMessageId?.slice(0, 10)}${tag(r)}`).join(',')}`);
                }
                return original.apply(this, args);
            };
        }
    };
    probe.renderMetrics = () => {
        const counts = globalThis.__QAAP_TRANSCRIPT_RENDER_METRICS__?.counts ?? {};
        return Object.fromEntries(Object.entries({ ...counts }).filter(([, value]) => value));
    };
    window.__qaapScrollPerf = probe;
}

/** Main-thread time by trace event name (top-level slices only), e.g. Layout vs Paint vs FunctionCall. */
function summarizeTrace(events, limit = 14) {
    const main = events.find(event => event.name === 'thread_name' && event.args?.name === 'CrRendererMain');
    const slices = events.filter(event => event.ph === 'X' && main && event.pid === main.pid && event.tid === main.tid)
        .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    const totals = new Map();
    const counts = new Map();
    const stack = [];
    for (const event of slices) {
        while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= event.ts) {
            stack.pop();
        }
        // Self time: charge the event, then subtract it from its parent.
        totals.set(event.name, (totals.get(event.name) ?? 0) + event.dur);
        counts.set(event.name, (counts.get(event.name) ?? 0) + 1);
        if (stack.length) {
            const parent = stack.at(-1).name;
            totals.set(parent, (totals.get(parent) ?? 0) - event.dur);
        }
        stack.push(event);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
        .map(([name, us]) => `${(us / 1000).toFixed(0).padStart(6)}ms ${name} ×${counts.get(name)}`);
}

/** What invalidates style: counts by tracking event, reason and selector/attribute (debug only). */
function summarizeInvalidations(events, limit = 25) {
    const counts = new Map();
    const layoutTrees = events.filter(event => event.name === 'UpdateLayoutTree' && event.ph === 'X');
    const elements = layoutTrees.map(event => event.args?.elementCount ?? event.args?.data?.elementCount).filter(Number.isFinite);
    for (const event of events) {
        if (!/Invalidat/.test(event.name)) {
            continue;
        }
        const data = event.args?.data ?? {};
        const what = data.reason ?? data.changedClass ?? data.changedAttribute ?? data.changedId ?? data.changedPseudo ?? '';
        const selectors = (data.selectors ?? []).map(selector => selector.selector ?? selector).join(' | ').slice(0, 140);
        const node = (data.nodeName ?? '').slice(0, 60);
        const key = `${event.name} ${what} ${selectors} @${node}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [`UpdateLayoutTree elementCount avg ${elements.length ? Math.round(elements.reduce((a, b) => a + b, 0) / elements.length) : '?'} max ${elements.length ? Math.max(...elements) : '?'}`,
        ...[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => `${String(count).padStart(6)} ${key}`)];
}

/** Top self-time functions of a CPU profile (ms), so a run names what saturates the main thread. */
function summarizeProfile(profile, limit = 25) {
    const byId = new Map(profile.nodes.map(node => [node.id, node]));
    const selfMs = new Map();
    const deltas = profile.timeDeltas ?? [];
    profile.samples.forEach((id, index) => {
        const node = byId.get(id);
        const frame = node.callFrame;
        const url = frame.url ? frame.url.replace(/^.*\//, '') : '';
        const key = `${frame.functionName || '(anonymous)'} ${url}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
        selfMs.set(key, (selfMs.get(key) ?? 0) + (deltas[index] ?? 0) / 1000);
    });
    return [...selfMs.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, ms]) => `${ms.toFixed(0).padStart(6)}ms ${key}`);
}

function summarizePhase(name, state, durationMs) {
    const frames = [...state.frames].sort((a, b) => a - b);
    const pct = p => frames.length ? Number(frames[Math.min(frames.length - 1, Math.floor(frames.length * p))].toFixed(1)) : 0;
    const total = state.frames.reduce((sum, gap) => sum + gap, 0);
    const drift = state.anchorDrift.filter(Number.isFinite);
    const driftDeltas = drift.slice(1).map((value, i) => Math.abs(value - drift[i]));
    return {
        phase: name,
        durationMs: Math.round(durationMs),
        frames: frames.length,
        fps: total ? Number((frames.length / (total / 1000)).toFixed(1)) : 0,
        frameP50: pct(0.5),
        frameP95: pct(0.95),
        frameP99: pct(0.99),
        framesOver25ms: frames.filter(gap => gap > 25).length,
        framesOver50ms: frames.filter(gap => gap > 50).length,
        jankRatio: frames.length ? Number((frames.filter(gap => gap > 25).length / frames.length).toFixed(3)) : 0,
        longTasks: state.longTasks.length,
        longTaskMs: state.longTasks.reduce((sum, value) => sum + value, 0),
        longTaskMax: state.longTasks.length ? Math.max(...state.longTasks) : 0,
        scrollWrites: state.writeCount,
        noopScrollWrites: state.noopWriteCount,
        scrollWritesBy: state.writes,
        anchorMaxDriftPx: drift.length ? Number(Math.max(...drift.map(Math.abs)).toFixed(1)) : undefined,
        anchorJumps: driftDeltas.filter(delta => delta >= 1).length,
        geometry: { start: state.startGeometry, end: state.endGeometry },
    };
}

async function measureOnce(options, run) {
    const require = createRequire(join(ROOT, 'package.json'));
    const { chromium } = require('playwright');
    const work = mkdtempSync(join(tmpdir(), 'qaap-scroll-perf-'));
    const home = join(work, 'home');
    const bin = join(work, 'bin');
    const repo = join(work, 'repo');
    for (const dir of [home, bin, repo]) {
        mkdirSync(dir, { recursive: true });
    }
    // The sticky composer starts the default agent (openclaude); both speak Claude-style stream-json.
    for (const cli of ['qaiq', 'openclaude']) {
        writeFileSync(join(bin, cli), `#!/usr/bin/env bash\nexec "${process.execPath}" "${FAKE_QAIQ}" "$@"\n`);
        chmodSync(join(bin, cli), 0o755);
    }
    // node alone, not its directory: global npm CLIs (gemini, codex…) live next to it.
    symlinkSync(process.execPath, join(bin, 'node'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    writeFileSync(join(repo, 'README.md'), '# scroll perf\n');
    execFileSync('git', ['-c', 'user.email=e2e@qaap.local', '-c', 'user.name=e2e', 'add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=e2e@qaap.local', '-c', 'user.name=e2e', 'commit', '-qm', 'init'], { cwd: repo });

    const base = `http://127.0.0.1:${options.port}`;
    const env = {
        ...process.env,
        HOME: home,
        // Only the fake agents (plus node and the system tools): the default agent the composer
        // picks depends on which agent CLIs it finds, and a real one installed here must not win.
        PATH: [bin, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
        QAAP_SKIP_AUTH: 'true',
        QAAP_CLOUD_MODE: 'local',
        OPENROUTER_API_KEY: 'mock-scroll-perf',
        QAAP_AGENT_AUTO_CONTINUE: '0',
        QAAP_TASK_PR: '0',
        QAAP_PERF_STREAM_MS: String(options.streamMs),
    };
    if (await fetch(`${base}/`).then(() => true, () => false)) {
        throw new Error(`port ${options.port} is already serving: pick a free --port`);
    }
    const logPath = join(work, 'backend.log');
    const out = openSync(logPath, 'a');
    const backend = spawn(process.execPath, [BACKEND, '--port', String(options.port), '--hostname', '127.0.0.1'], {
        cwd: join(ROOT, 'examples/browser'), env, detached: true, stdio: ['ignore', out, out],
    });
    if (options.serve) {
        await waitFor('the backend', 120_000, async () => (await fetch(`${base}/`)).status < 500);
        console.log(`serving ${base}/#${repo} (fake agent streams ${options.streamMs} ms); Ctrl-C to stop`);
        await new Promise(() => {
            setInterval(() => undefined, 60_000);
            for (const signal of ['SIGINT', 'SIGTERM']) {
                process.on(signal, () => {
                    try {
                        process.kill(-backend.pid, 'SIGKILL');
                    } catch {
                        // Already gone.
                    }
                    process.exit(0);
                });
            }
        });
    }
    const browser = await chromium.launch({ headless: !options.headed });
    let ok = false;
    try {
        await waitFor('the backend', 120_000, async () => (await fetch(`${base}/`)).status < 500);
        const context = await browser.newContext({
            viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
        });
        const page = await context.newPage();
        await page.addInitScript(installPageProbe, TRANSCRIPT);
        const cdp = await context.newCDPSession(page);
        const transport = {};
        if (process.env.QAAP_PERF_DEBUG) {
            page.on('websocket', socket => socket.on('framereceived', frame => {
                const key = `ws ${new URL(socket.url()).pathname}`;
                transport[key] = (transport[key] || 0) + 1;
                const text = String(frame.payload);
                const kind = /"type":"([\w.-]+)"/.exec(text)?.[1] ?? 'binary';
                transport[`${key} ${kind}`] = (transport[`${key} ${kind}`] || 0) + 1;
                const deltaKind = /"delta":\{"kind":"(\w+)"/.exec(text)?.[1];
                if ((kind === 'message' || (kind === 'message_delta' && deltaKind !== 'patch_trace_event')) && (transport.printed = (transport.printed || 0) + 1) <= 8) {
                    console.log(`debug frame ${text.replace(/"cwd":"[^"]*",/, '').slice(0, 1200)}`);
                }
            }));
            page.on('response', response => {
                if (/event-stream/.test(response.headers()['content-type'] ?? '')) {
                    transport[`sse ${new URL(response.url()).pathname}`] = (transport[`sse ${new URL(response.url()).pathname}`] || 0) + 1;
                }
            });
            page.on('console', message => {
                if (message.type() === 'error') {
                    console.log(`debug console error ${message.text().slice(0, 300)}`);
                }
            });
        }
        await page.goto(`${base}/#${repo}`, { waitUntil: 'domcontentloaded' });
        const composer = page.locator('.theia-mobile-projects:visible .theia-mobile-projects-sticky-composer-input').first();
        await composer.waitFor({ state: 'visible', timeout: 120_000 });
        const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
        if (await skip.count()) {
            await skip.click().catch(() => undefined);
        }
        await page.evaluate(() => window.__qaapScrollPerf.enableRenderMetrics());
        if (process.env.QAAP_PERF_STRIP_RULES) {
            // Experiment hook: drop the CSS rules whose selector matches, to price them.
            const stripped = await page.evaluate(pattern => {
                const matcher = new RegExp(pattern);
                let count = 0;
                const visit = list => {
                    for (let index = list.cssRules.length - 1; index >= 0; index--) {
                        const rule = list.cssRules[index];
                        if (rule.cssRules && !rule.selectorText) {
                            visit(rule);
                        } else if (rule.selectorText && matcher.test(rule.selectorText)) {
                            list.deleteRule(index);
                            count++;
                        }
                    }
                };
                for (const sheet of document.styleSheets) {
                    try {
                        visit(sheet);
                    } catch {
                        // Cross-origin sheet.
                    }
                }
                return count;
            }, process.env.QAAP_PERF_STRIP_RULES);
            console.log(`stripped ${stripped} CSS rules matching ${process.env.QAAP_PERF_STRIP_RULES}`);
        }
        if (process.env.QAAP_PERF_DEBUG) {
            await page.evaluate(() => window.__qaapScrollPerf.installTrace());
        }
        await composer.fill('Explain how the transcript keeps the reader anchored while streaming.');
        await page.getByRole('button', { name: /^send$|^create$/i }).click();

        const scroller = page.locator(`${TRANSCRIPT}:visible`).first();
        await scroller.waitFor({ state: 'visible', timeout: 60_000 });
        // Wait until the long answer is streaming and the transcript overflows a few screens.
        const waitStarted = Date.now();
        const debugTimer = process.env.QAAP_PERF_DEBUG ? setInterval(async () => {
            const list = await (await fetch(`${base}/qaap/api/agent-conversations?cwd=${encodeURIComponent(repo)}`)).json().catch(() => ({}));
            const id = list.conversations?.[0]?.id;
            const detail = id ? await (await fetch(`${base}/qaap/api/agent-conversations/${id}`)).json().catch(() => ({})) : {};
            const geometry = await page.evaluate(() => {
                const rows = [...document.querySelectorAll('[data-transcript-message-id]')];
                const counts = globalThis.__QAAP_TRANSCRIPT_RENDER_METRICS__?.counts ?? {};
                const pick = ['sse_scheduled', 'sse_flushed', 'render_full', 'render_patch_last_agent', 'render_skip_unchanged_tail', 'render_patch_none'];
                const host = [...(rows.at(-1)?.querySelectorAll('[data-qaap-stream-total-length], .theia-mod-markdown, [class*="streaming"]') ?? [])]
                    .find(element => element.dataset.qaapStreamTotalLength !== undefined) ?? undefined;
                const streamHost = host ? `${host.dataset.qaapStreamStableLength}/${host.dataset.qaapStreamTotalLength}`
                    + ` parsed=${host.dataset.transcriptStreamParsedLen} preview=${host.querySelector(':scope > [class*="plain-preview"]')?.textContent?.length}`
                    + ` text=${host.textContent.length} cls=${host.className.replace(/theia-mobile-agent-transcript-/g, '').slice(0, 120)}` : 'none';
                return { ...window.__qaapScrollPerf.geometry(), lastRowText: rows.at(-1)?.innerText.length, streamHost,
                    metrics: pick.map(key => `${key.replace('render_', '')}=${counts[key] ?? 0}`).join(' '), hidden: document.visibilityState };
            }).catch(error => String(error).slice(0, 80));
            if ((detail.messages ?? []).some(m => (m.traceEvents ?? []).some(e => e.id === 'text-2' && (e.content ?? '').length > 900)) && !debugTimer.shot) {
                debugTimer.shot = true;
                await page.screenshot({ path: join(work, 'mid-stream.png') }).catch(() => undefined);
                const rows = await page.evaluate(() => {
                    const tree = (element, depth) => {
                        const own = `${element.tagName.toLowerCase()}.${String(element.className).replace(/theia-mobile-agent-transcript-/g, '~').split(' ').slice(0, 4).join('.')}`
                            + `[t=${element.textContent.length}${Object.keys(element.dataset).length ? ` d=${JSON.stringify(element.dataset).slice(0, 160)}` : ''}]`;
                        return depth >= 7 || !element.children.length ? own
                            : `${own}{${[...element.children].slice(0, 6).map(child => tree(child, depth + 1)).join(' ')}}`;
                    };
                    const rows = [...document.querySelectorAll('[data-transcript-message-id]')];
                    return rows.length ? tree(rows.at(-1), 0) : 'no rows';
                });
                console.log(`debug rows ${rows}`);
                console.log(`debug where ${JSON.stringify(await page.evaluate(() => {
                    const hits = [];
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                        if (node.textContent.includes('streaming checkpoint')) {
                            const path = [];
                            for (let el = node.parentElement; el && path.length < 8; el = el.parentElement) {
                                path.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}${el.dataset.transcriptMessageId ? `#${el.dataset.transcriptMessageId.slice(0, 8)}` : ''}`);
                            }
                            hits.push({ visible: !!node.parentElement.getClientRects().length, path: path.join(' < ') });
                        }
                    }
                    const ids = [...document.querySelectorAll('[data-transcript-message-id]')].map(row => `${row.dataset.transcriptMessageId.slice(0, 8)}:${row.isConnected}:${row.getClientRects().length}`);
                    return { hits: hits.slice(0, 5), ids, hosts: document.querySelectorAll('.theia-mobile-agent-transcript').length };
                }))}`);
                console.log(`debug metrics ${JSON.stringify(await page.evaluate(() => window.__qaapScrollPerf.renderMetrics()))}`);
                const trace = await page.evaluate(() => {
                    const p = window.__qaapScrollPerf;
                    const hosts = [...document.querySelectorAll('.theia-mobile-agent-transcript')].map(h => `${p.tag(h)} rows=${h.querySelectorAll('[data-transcript-message-id]').length} vis=${h.getClientRects().length}`);
                    return { hosts, trace: p.trace };
                });
                await import('node:fs').then(fs => fs.writeFileSync(join(work, 'trace.txt'), `${JSON.stringify(trace.hosts)}\n${trace.trace.join('\n')}`));
                console.log(`debug trace ${join(work, 'trace.txt')} hosts=${JSON.stringify(trace.hosts)}`);
            }
            console.log(`debug t=${Date.now() - waitStarted} status=${detail.status} agent=${detail.agent} chars=${(detail.messages ?? []).map(m => `${m.role}:${m.content?.length}[${(m.traceEvents ?? []).map(e => `${e.id}/${(e.content ?? '').length}`).join(' ')}]`).join(',')} geo=${JSON.stringify(geometry)}`);
        }, 4000) : undefined;
        await waitFor('a streaming transcript taller than 3 screens', 120_000, async () => page.evaluate(() => {
            const element = window.__qaapScrollPerf.scroller();
            return element && element.scrollHeight > element.clientHeight * 3;
        }));
        clearInterval(debugTimer);
        if (process.env.QAAP_PERF_DEBUG) {
            console.log(`debug transport ${JSON.stringify(transport)}`);
        }
        console.log(`transcript overflowed 3 screens after ${Date.now() - waitStarted} ms`);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpu });
        const box = await scroller.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

        const phases = [];
        const profiles = {};
        const traces = {};
        const traceEvents = [];
        cdp.on('Tracing.dataCollected', ({ value }) => traceEvents.push(...value));
        const runPhase = async (name, durationMs, body) => {
            await page.evaluate(phase => window.__qaapScrollPerf.setPhase(phase), name);
            if (options.trace) {
                traceEvents.length = 0;
                await cdp.send('Tracing.start', {
                    categories: `devtools.timeline,disabled-by-default-devtools.timeline${process.env.QAAP_PERF_INVALIDATIONS ? ',disabled-by-default-devtools.timeline.invalidationTracking' : ''}`,
                    transferMode: 'ReportEvents',
                });
            }
            if (options.profile) {
                await cdp.send('Profiler.enable');
                await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
                await cdp.send('Profiler.start');
            }
            const started = Date.now();
            await body(started + durationMs);
            const remaining = started + durationMs - Date.now();
            if (remaining > 0) {
                await sleep(remaining);
            }
            phases.push([name, Date.now() - started]);
            if (options.trace) {
                const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
                await cdp.send('Tracing.end');
                await done;
                traces[name] = summarizeTrace(traceEvents);
                if (process.env.QAAP_PERF_INVALIDATIONS) {
                    traces[`${name} invalidations`] = summarizeInvalidations(traceEvents);
                }
            }
            if (options.profile) {
                const { profile } = await cdp.send('Profiler.stop');
                writeFileSync(join(work, `${name}.cpuprofile`), JSON.stringify(profile));
                profiles[name] = summarizeProfile(profile);
            }
        };
        const phaseBudget = options.phaseMs;
        // A new turn pins the prompt to the top and the answer grows below it (no auto-follow):
        // `stream` watches it grow untouched, `scroll` reads down through it, `hold` rests mid-answer.
        await runPhase('stream', phaseBudget, async () => undefined);
        await runPhase('scroll', phaseBudget, async deadline => {
            while (Date.now() < deadline - 150) {
                await page.mouse.wheel(0, 90);
                await sleep(120);
            }
        });
        await runPhase('hold', phaseBudget, async () => undefined);
        await page.evaluate(() => window.__qaapScrollPerf.setPhase('done'));
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

        const raw = await page.evaluate(() => ({
            phases: window.__qaapScrollPerf.phases,
            renderMetrics: window.__qaapScrollPerf.renderMetrics(),
            stillStreaming: !!document.querySelector('.theia-mod-streaming, [data-streaming="true"]'),
        }));
        const result = {
            ...(options.profile ? { profiles } : {}),
            ...(options.trace ? { traces } : {}),
            run,
            cpuThrottle: options.cpu,
            streamMs: options.streamMs,
            phases: phases.map(([name, duration]) => summarizePhase(name, raw.phases[name], duration)),
            renderMetrics: raw.renderMetrics,
        };
        ok = true;
        return result;
    } catch (error) {
        await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(work, 'failure.png') }).catch(() => undefined);
        throw error;
    } finally {
        await browser.close().catch(() => undefined);
        try {
            process.kill(-backend.pid, 'SIGKILL');
        } catch {
            // Already gone.
        }
        if (options.keep || !ok) {
            console.error(`work dir kept: ${work}`);
            if (!ok) {
                console.error(readFileSync(logPath, 'utf8').split('\n').slice(-30).join('\n'));
            }
        } else {
            rmSync(work, { recursive: true, force: true });
        }
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (!existsSync(BACKEND)) {
        throw new Error(`${BACKEND} not found: run npm run build:browser first`);
    }
    const results = [];
    for (let run = 1; run <= options.runs; run++) {
        const result = await measureOnce(options, run);
        results.push(result);
        for (const phase of result.phases) {
            console.log(`run ${run} ${phase.phase.padEnd(6)} fps ${phase.fps} p95 ${phase.frameP95}ms p99 ${phase.frameP99}ms `
                + `jank ${phase.jankRatio} longTasks ${phase.longTasks}/${phase.longTaskMs}ms writes ${phase.scrollWrites} `
                + `(noop ${phase.noopScrollWrites}) geo ${JSON.stringify(phase.geometry)}${phase.anchorMaxDriftPx === undefined ? '' : ` drift ${phase.anchorMaxDriftPx}px jumps ${phase.anchorJumps}`}`);
            if (phase.scrollWrites) {
                console.log(`         writers ${JSON.stringify(phase.scrollWritesBy)}`);
            }
        }
        console.log(`run ${run} render ${JSON.stringify(result.renderMetrics)}`);
        for (const [name, top] of Object.entries(result.traces ?? {})) {
            console.log(`run ${run} trace ${name}\n  ${top.join('\n  ')}`);
        }
        for (const [name, top] of Object.entries(result.profiles ?? {})) {
            console.log(`run ${run} profile ${name}\n  ${top.join('\n  ')}`);
        }
    }
    if (options.out) {
        writeFileSync(options.out, `${JSON.stringify(results, undefined, 2)}\n`);
        console.log(`wrote ${options.out}`);
    }
}

main().catch(error => {
    console.error(`FAIL  ${error?.stack ?? error}`);
    process.exitCode = 1;
});
