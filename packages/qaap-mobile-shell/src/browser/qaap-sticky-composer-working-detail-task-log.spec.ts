// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    appendWorkingDetailTaskLogChunk,
    isWorkingDetailTaskLogNearBottom,
    parseWorkingDetailTaskLogSegments,
    renderWorkingDetailTaskLog,
    seedWorkingDetailTaskLog,
    shouldShowWorkingDetailTaskLog,
    updateWorkingDetailTaskLog,
    workingDetailTaskLogHasTranscriptSegments,
    WORKING_DETAIL_TASK_LOG_MAX_BYTES,
} from './qaap-sticky-composer-working-detail-task-log';

describe('qaap-sticky-composer-working-detail-task-log', () => {
    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });
    it('appends chunks and keeps a bounded tail', () => {
        const first = appendWorkingDetailTaskLogChunk('', 'hello\n');
        expect(first.text).to.equal('hello\n');
        expect(first.truncated).to.equal(false);

        const second = appendWorkingDetailTaskLogChunk(first.text, 'world\n');
        expect(second.text).to.equal('hello\nworld\n');

        const oversized = 'x'.repeat(WORKING_DETAIL_TASK_LOG_MAX_BYTES + 40);
        const clipped = appendWorkingDetailTaskLogChunk('', oversized, WORKING_DETAIL_TASK_LOG_MAX_BYTES);
        expect(clipped.text.length).to.equal(WORKING_DETAIL_TASK_LOG_MAX_BYTES);
        expect(clipped.truncated).to.equal(true);
        expect(clipped.text.endsWith('x'.repeat(20))).to.equal(true);
    });

    it('seeds a server log tail for mid-run DETAIL open', () => {
        const seeded = seedWorkingDetailTaskLog('line1\nline2\n');
        expect(seeded.text).to.equal('line1\nline2\n');
        expect(seeded.truncated).to.equal(false);

        const long = 'y'.repeat(WORKING_DETAIL_TASK_LOG_MAX_BYTES + 8);
        const clipped = seedWorkingDetailTaskLog(long);
        expect(clipped.text.length).to.equal(WORKING_DETAIL_TASK_LOG_MAX_BYTES);
        expect(clipped.truncated).to.equal(true);
    });

    it('only shows the command log for VPS members without conversationId', () => {
        expect(shouldShowWorkingDetailTaskLog({ taskId: 't1' })).to.equal(true);
        expect(shouldShowWorkingDetailTaskLog({ taskId: 't1', conversationId: 'c1' })).to.equal(false);
        expect(shouldShowWorkingDetailTaskLog({ conversationId: 'c1' })).to.equal(false);
        expect(shouldShowWorkingDetailTaskLog({})).to.equal(false);
    });

    it('renders a mono log card and updates text with auto-scroll near bottom', () => {
        const root = renderWorkingDetailTaskLog({
            taskId: 'task-1',
            text: '',
            running: true,
            loading: true,
        });
        expect(root.dataset.taskId).to.equal('task-1');
        expect(root.dataset.state).to.equal('running');
        expect(root.dataset.loading).to.equal('true');
        expect(root.querySelector('.qaap-working-agents-detail-command-log-label')?.textContent)
            .to.match(/Command output/i);
        expect(root.querySelector('.qaap-working-agents-detail-command-log-live')).to.not.equal(null);
        const output = root.querySelector('.qaap-working-agents-detail-command-log-output');
        expect(output).to.be.instanceOf(HTMLElement);
        expect(output?.textContent).to.match(/Waiting for output/i);
        expect(output?.classList.contains('theia-mod-waiting')).to.equal(true);

        Object.defineProperty(output, 'scrollHeight', { configurable: true, get: () => 400 });
        Object.defineProperty(output, 'clientHeight', { configurable: true, get: () => 120 });
        Object.defineProperty(output, 'scrollTop', {
            configurable: true,
            get: () => 260,
            set: () => undefined,
        });
        expect(isWorkingDetailTaskLogNearBottom(output as HTMLElement)).to.equal(true);

        let scrolledTo = -1;
        Object.defineProperty(output, 'scrollTop', {
            configurable: true,
            get: () => scrolledTo < 0 ? 260 : scrolledTo,
            set: (value: number) => { scrolledTo = value; },
        });
        updateWorkingDetailTaskLog(root, {
            text: 'npm test\nok\n',
            running: true,
            loading: false,
        });
        expect(output?.textContent).to.contain('npm test');
        expect(output?.classList.contains('theia-mod-empty')).to.equal(false);
        expect(root.dataset.loading).to.equal(undefined);
        expect(scrolledTo).to.equal(400);

        updateWorkingDetailTaskLog(root, {
            text: 'done\n',
            running: false,
            truncated: true,
            forceScrollToBottom: true,
        });
        expect(root.dataset.state).to.equal('idle');
        expect(root.dataset.truncated).to.equal('true');
        expect(output?.textContent).to.match(/truncated/i);
        expect(output?.getAttribute('aria-live')).to.equal('off');
    });

    it('formats OpenCode NDJSON as a readable transcript instead of raw JSON', () => {
        const root = renderWorkingDetailTaskLog({
            taskId: 'task-oc',
            text: '',
            running: true,
        });
        const output = root.querySelector('.qaap-working-agents-detail-command-log-output');
        updateWorkingDetailTaskLog(root, {
            text: [
                '{"type":"tool_use","part":{"id":"p1","type":"tool","tool":"read","state":{"status":"completed","input":{"filePath":"a.ts"},"output":"ok"}}}',
                '{"type":"text","part":{"type":"text","text":"Done reading."}}',
                '{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":1,"output":1}}}',
            ].join('\n'),
            running: true,
        });
        expect(output?.textContent).to.include('Read');
        expect(output?.textContent).to.include('Done reading.');
        expect(output?.textContent).to.not.include('step_finish');
        expect(output?.textContent).to.not.include('"tokens"');
    });

    it('detects structured OpenCode transcript segments in the task log', () => {
        const log = '{"type":"text","part":{"type":"text","text":"Hola"}}\n';
        expect(workingDetailTaskLogHasTranscriptSegments(log)).to.equal(true);
        expect(parseWorkingDetailTaskLogSegments(log)).to.deep.equal([{ type: 'text', content: 'Hola' }]);
        expect(workingDetailTaskLogHasTranscriptSegments('{"type":"step_finish","part":{"type":"step-finish"}}')).to.equal(false);
    });

    it('shows a settled empty state when the task finished with no output', () => {
        const root = renderWorkingDetailTaskLog({
            taskId: 'task-empty',
            text: '',
            running: false,
        });
        const output = root.querySelector('.qaap-working-agents-detail-command-log-output');
        expect(output?.textContent).to.match(/No output/i);
        expect(output?.classList.contains('theia-mod-waiting')).to.equal(false);
    });
});
