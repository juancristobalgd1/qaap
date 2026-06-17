#!/usr/bin/env node
// *****************************************************************************
// Benchmark activity timeline sync for long tool turns (run after compile):
//   npm run compile
//   node scripts/qaap-agent-trace-timeline-render-bench.js
// *****************************************************************************

const { parseHTML } = require('linkedom');
const { window } = parseHTML('<!DOCTYPE html><html><body></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.CSS = { escape: value => String(value).replace(/"/g, '\\"') };
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);

const {
    enableTranscriptRenderMetrics,
    getTranscriptRenderMetricsSnapshot,
} = require('../packages/qaap-transcript-overlay/lib/common/qaap-transcript-render-metrics');
const {
    fingerprintTranscriptTimelineSync,
    TRANSCRIPT_TIMELINE_SYNC_FP_ATTR,
} = require('../packages/qaap-mobile-shell/lib/common/qaap-transcript-timeline-sync-fingerprint');
const {
    resolveTranscriptTimelineVisibilityPolicy,
} = require('../packages/qaap-mobile-shell/lib/common/qaap-transcript-timeline-visibility');
const {
    readTranscriptTimelineExpandState,
    resolveTranscriptTimelineRenderWindowWithExpand,
} = require('../packages/qaap-mobile-shell/lib/common/qaap-transcript-timeline-gap-expand');
const { TRANSCRIPT_TIMELINE_VIRTUALIZE_THRESHOLD } = require('../packages/qaap-mobile-shell/lib/common/qaap-transcript-timeline-window');

const TOOL_COUNT = 55;
const SSE_TICKS = 600;

function buildToolSegments(count, runningIndex) {
    const segments = [{ type: 'thinking', content: 'Planning reads…' }];
    for (let index = 0; index < count; index++) {
        const finished = index < runningIndex;
        segments.push({
            type: 'tool',
            name: 'Read',
            toolUseId: `tool-${index}`,
            args: JSON.stringify({ path: `packages/qaap-mobile-shell/src/browser/file-${index}.ts` }),
            result: finished ? 'ok' : undefined,
            finished,
        });
    }
    return segments;
}

function buildVisibleItems(segments) {
    return segments
        .map((segment, segmentIndex) => {
            if (segment.type !== 'tool') {
                return undefined;
            }
            return {
                label: `Read file-${segmentIndex}.ts`,
                state: segment.finished ? 'success' : 'running',
                segmentIndex,
            };
        })
        .filter(Boolean);
}

function simulateTimelineSyncWithoutSkip(timeline, visibleItems, options) {
    const expandState = readTranscriptTimelineExpandState(timeline);
    const policy = resolveTranscriptTimelineVisibilityPolicy(visibleItems, {});
    const activeIndex = visibleItems.findIndex(item => item.state === 'running');
    const focusIndex = activeIndex >= 0 ? activeIndex : visibleItems.length - 1;
    const renderWindow = resolveTranscriptTimelineRenderWindowWithExpand(visibleItems.length, {
        focusIndex,
        enabled: visibleItems.length > TRANSCRIPT_TIMELINE_VIRTUALIZE_THRESHOLD,
        expand: expandState,
    });
    const fingerprint = fingerprintTranscriptTimelineSync(
        visibleItems,
        activeIndex,
        renderWindow,
        expandState,
        {
            expanded: true,
            collapsed: policy.collapsed,
            hiddenCount: policy.hiddenCount,
        },
    );
    timeline.setAttribute(TRANSCRIPT_TIMELINE_SYNC_FP_ATTR, fingerprint);
    return { renderWindow, policy };
}

function simulateTimelineSyncWithSkip(timeline, visibleItems, options) {
    const expandState = readTranscriptTimelineExpandState(timeline);
    const policy = resolveTranscriptTimelineVisibilityPolicy(visibleItems, {});
    const activeIndex = visibleItems.findIndex(item => item.state === 'running');
    const focusIndex = activeIndex >= 0 ? activeIndex : visibleItems.length - 1;
    const renderWindow = resolveTranscriptTimelineRenderWindowWithExpand(visibleItems.length, {
        focusIndex,
        enabled: visibleItems.length > TRANSCRIPT_TIMELINE_VIRTUALIZE_THRESHOLD,
        expand: expandState,
    });
    const fingerprint = fingerprintTranscriptTimelineSync(
        visibleItems,
        activeIndex,
        renderWindow,
        expandState,
        {
            expanded: true,
            collapsed: policy.collapsed,
            hiddenCount: policy.hiddenCount,
        },
    );
    const previous = timeline.getAttribute(TRANSCRIPT_TIMELINE_SYNC_FP_ATTR);
    if (previous === fingerprint) {
        return { skipped: true, renderWindow, policy };
    }
    timeline.setAttribute(TRANSCRIPT_TIMELINE_SYNC_FP_ATTR, fingerprint);
    return { skipped: false, renderWindow, policy };
}

function benchTimelineSync(label, useSkip, ticks) {
    let syncCount = 0;
    let skipCount = 0;
    const timeline = document.createElement('details');
    timeline.className = 'theia-mobile-agent-activity-timeline theia-mod-cursor-trace';
    timeline.open = true;
    const start = performance.now();
    for (let tick = 0; tick < ticks; tick++) {
        const toolCount = Math.min(TOOL_COUNT, 1 + Math.floor((tick / ticks) * TOOL_COUNT));
        const runningIndex = Math.min(toolCount, Math.floor(tick / 8));
        const segments = buildToolSegments(toolCount, runningIndex);
        const visibleItems = buildVisibleItems(segments);
        const result = useSkip
            ? simulateTimelineSyncWithSkip(timeline, visibleItems)
            : simulateTimelineSyncWithoutSkip(timeline, visibleItems);
        if (result.skipped) {
            skipCount += 1;
        } else {
            syncCount += 1;
        }
    }
    const totalMs = performance.now() - start;
    return { label, ticks, syncCount, skipCount, totalMs: round(totalMs), perTickMs: round(totalMs / ticks) };
}

function round(value) {
    return Math.round(value * 100) / 100;
}

console.log('Qaap agent trace timeline sync benchmark');
console.log('─'.repeat(56));
console.log(`Tools cap: ${TOOL_COUNT}, SSE ticks: ${SSE_TICKS}`);
console.log('');

const baseline = benchTimelineSync('Without fingerprint skip', false, SSE_TICKS);
const optimized = benchTimelineSync('With fingerprint skip', true, SSE_TICKS);

for (const row of [baseline, optimized]) {
    console.log(`${row.label}`);
    console.log(`  total ms: ${row.totalMs}  ms/tick: ${row.perTickMs}`);
    console.log(`  timeline sync: ${row.syncCount}  skipped: ${row.skipCount}`);
    console.log('');
}

const reduction = baseline.syncCount > 0
    ? round((1 - optimized.syncCount / baseline.syncCount) * 100)
    : 0;
console.log(`DOM sync reduction: ${reduction}% (${baseline.syncCount} → ${optimized.syncCount})`);
console.log('');
console.log('Enable live metrics in browser devtools:');
console.log('  window.__QAAP_TRANSCRIPT_RENDER_METRICS__.enabled = true');

enableTranscriptRenderMetrics(true);
for (let tick = 0; tick < 50; tick++) {
    const segments = buildToolSegments(50, tick % 50);
    const visibleItems = buildVisibleItems(segments);
    simulateTimelineSyncWithSkip(document.createElement('details'), visibleItems);
}
console.log('Sample metrics snapshot:', getTranscriptRenderMetricsSnapshot());
