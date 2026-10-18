#!/usr/bin/env node
// Fake `qaiq` / `openclaude` for the transcript scroll-performance harness (scripts/qaap-transcript-scroll-perf.mjs).
//
// Speaks the Claude-style stream-json both CLIs use over stdio and streams one long,
// markdown-heavy answer as `stream_event` text deltas (paragraphs, a long paragraph with no blank
// line, lists, code fences, a table) interleaved with a few tool calls, so the Work Hub transcript
// exercises its real SSE → patch → markdown-tail path for as long as the measurement needs.
//
// Pacing comes from the environment so the harness controls the turn length:
//   QAAP_PERF_STREAM_MS     total streaming time in ms (default 45000)
//   QAAP_PERF_TICK_MS       delay between deltas in ms (default 25)
if (process.argv[2] === '--version') {
    console.log('qaiq 0.0.0-scroll-perf');
    process.exit(0);
}

const STREAM_MS = Number(process.env.QAAP_PERF_STREAM_MS || 45_000);
const TICK_MS = Number(process.env.QAAP_PERF_TICK_MS || 25);

const sleep = ms => new Promise(done => setTimeout(done, ms));
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);

function buildAnswer(targetChars) {
    const words = ('the transcript keeps the reader anchored while the agent streams new markdown into the tail '
        + 'so every patch must touch only the open block and never move what the reader is looking at').split(' ');
    const sentence = (seed, length) => {
        const out = [];
        for (let i = 0; i < length; i++) {
            out.push(words[(seed * 7 + i * 3) % words.length]);
        }
        const text = out.join(' ');
        return `${text[0].toUpperCase()}${text.slice(1)}.`;
    };
    const blocks = [];
    let section = 0;
    let size = 0;
    while (size < targetChars) {
        section++;
        const parts = [`## Section ${section}: streaming checkpoint`];
        parts.push(Array.from({ length: 4 }, (_, i) => sentence(section + i, 14 + (i % 3) * 5)).join(' '));
        // A long paragraph with no blank line: the markdown tail is the whole paragraph.
        parts.push(Array.from({ length: 14 }, (_, i) => sentence(section * 3 + i, 18)).join(' '));
        parts.push(Array.from({ length: 5 }, (_, i) => `- **Item ${section}.${i + 1}**: ${sentence(section + i * 2, 10)} Uses \`code_${i}\`.`).join('\n'));
        parts.push(['```ts', `export function step${section}(input: number): number {`, `    const doubled = input * 2; // section ${section}`,
            '    return doubled + 1;', '}', '```'].join('\n'));
        if (section % 2 === 0) {
            parts.push(['| Metric | Before | After |', '| --- | --- | --- |', `| frames | ${section * 3} | ${section * 4} |`,
                `| writes | ${section} | 0 |`].join('\n'));
        }
        const block = parts.join('\n\n');
        blocks.push(block);
        size += block.length + 2;
    }
    return blocks.join('\n\n');
}

async function streamText(index, text, deadline) {
    emit({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } } });
    let offset = 0;
    while (offset < text.length) {
        const remainingTicks = Math.max(1, Math.floor((deadline - Date.now()) / TICK_MS));
        const step = Math.max(2, Math.ceil((text.length - offset) / remainingTicks));
        const chunk = text.slice(offset, offset + step);
        offset += chunk.length;
        emit({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text: chunk } } });
        await sleep(TICK_MS);
    }
    emit({ type: 'stream_event', event: { type: 'content_block_stop', index } });
}

async function toolCall(index, id, name, input) {
    emit({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } } });
    emit({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } } });
    emit({ type: 'stream_event', event: { type: 'content_block_stop', index } });
    emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
    await sleep(300);
    emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: `ok: ${name} ${JSON.stringify(input)}` }] } });
}

async function main() {
    // The prompt arrives on stdin (qaiq) or argv (openclaude); the answer does not depend on it.
    process.stdin.resume();
    process.stdin.on('error', () => undefined);
    emit({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id: 'scroll-perf', tools: ['Read', 'Grep'], model: 'mock/scroll-perf' });
    const started = Date.now();
    const intro = 'I will read the transcript code first, then stream a long answer.';
    await streamText(0, intro, started + 1500);
    emit({ type: 'assistant', message: { content: [{ type: 'text', text: intro }] } });
    await toolCall(1, 'toolu_perf_read', 'Read', { file_path: 'README.md' });
    await toolCall(2, 'toolu_perf_grep', 'Grep', { pattern: 'scrollTop', path: '.' });
    const answer = buildAnswer(Math.round((STREAM_MS / 1000) * 260));
    await streamText(3, answer, started + STREAM_MS);
    emit({ type: 'assistant', message: { content: [{ type: 'text', text: answer }] } });
    emit({ type: 'result', subtype: 'success', is_error: false, result: answer });
}

main().catch(error => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exit(1);
});
