// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { groupTranscriptActivityNavigationItems, resolveTranscriptActivityNavigationItems, resolveTranscriptLifecycleActivityItems } from './qaap-transcript-activity-navigation';

const deps = {
    localizeActivityLabel: (label: string) => label,
    formatToolActivityLabel: (toolName: string) => `Running: ${toolName}`,
    localizePlanningLabel: () => 'Planning next steps',
    localizeWritingLabel: () => 'Preparing the response',
    localizeFailedLabel: (detail: string) => `Failed: ${detail}`,
    extractToolPath: (argsJson: string) => {
        try {
            const args = JSON.parse(argsJson) as { path?: string };
            return args.path;
        } catch {
            return undefined;
        }
    },
    extractToolCommand: (argsJson: string) => {
        try {
            const args = JSON.parse(argsJson) as { command?: string };
            return args.command;
        } catch {
            return undefined;
        }
    },
    resolveToolKind: (toolName: string) => {
        if (toolName.includes('bash')) {
            return 'terminal';
        }
        if (toolName.includes('read')) {
            return 'reading';
        }
        if (toolName.includes('edit')) {
            return 'editing';
        }
        return 'tool';
    },
    isToolResultFailed: (result?: string) => /\berror\b/i.test(result ?? ''),
};

describe('qaap-transcript-activity-navigation', () => {

    it('maps tool segments to file and terminal navigation targets', () => {
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'tool', name: 'read_file', args: '{"path":"src/a.ts"}', finished: true, toolUseId: '1' },
            { type: 'tool', name: 'bash', args: '{"command":"npm test"}', finished: false, toolUseId: '2' },
        ], deps, false);
        expect(items).to.have.length(2);
        expect(items[0]?.state).to.equal('success');
        expect(items[0]?.navigate).to.equal('file');
        expect(items[0]?.filePath).to.equal('src/a.ts');
        expect(items[1]?.state).to.equal('running');
        expect(items[1]?.navigate).to.equal('terminal');
    });

    it('promotes failed tools to error steps with a summary', () => {
        const items = resolveTranscriptActivityNavigationItems([
            {
                type: 'tool',
                name: 'bash',
                args: '{"command":"npm test"}',
                finished: true,
                toolUseId: '1',
                result: 'Error: tests failed with exit code 1',
            },
        ], deps, false);
        expect(items).to.have.length(1);
        expect(items[0]?.state).to.equal('error');
        expect(items[0]?.errorSummary).to.include('Error');
        expect(items[0]?.label).to.equal('Failed: Error: tests failed with exit code 1');
    });

    it('marks the following running tool as retrying after an error', () => {
        const items = resolveTranscriptActivityNavigationItems([
            {
                type: 'tool',
                name: 'bash',
                args: '{"command":"npm start"}',
                finished: true,
                toolUseId: '1',
                result: 'Error: port in use',
            },
            {
                type: 'tool',
                name: 'bash',
                args: '{"command":"npm start"}',
                finished: false,
                toolUseId: '2',
            },
        ], deps, false);
        expect(items[1]?.state).to.equal('retrying');
        expect(items[1]?.label).to.equal('Retrying: Ran npm start');
    });

    it('collapses consecutive planning rows into one timeline step', () => {
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'thinking', content: 'Plan A' },
            { type: 'thinking', content: 'Plan B' },
            { type: 'tool', name: 'read_file', args: '{"path":"src/a.ts"}', finished: true, toolUseId: '1' },
        ], deps, true);
        const grouped = groupTranscriptActivityNavigationItems(items);
        expect(grouped).to.have.length(2);
        expect(grouped[0]?.verb).to.equal('Thinking');
        expect(grouped[0]?.groupCount).to.equal(2);
        expect(grouped[0]?.detail).to.equal(undefined);
        expect(grouped[0]?.tail).to.equal(undefined);
        expect(grouped[0]?.thinkingContent).to.equal('Plan A\n\nPlan B');
        expect(grouped[1]?.verb).to.equal('Read');
    });

    it('keeps thinking excerpt out of collapsed timeline row metadata', () => {
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'thinking', content: 'Now I understand the project structure and will proceed carefully.' },
        ], deps, true);
        expect(items[0]?.verb).to.equal('Thinking');
        expect(items[0]?.detail).to.equal(undefined);
        expect(items[0]?.thinkingContent).to.include('Now I understand');
    });

    it('propagates thinking durationMs from resolveStepDurationMs', () => {
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'thinking', content: 'Plan A' },
            { type: 'thinking', content: 'Plan B' },
            { type: 'tool', name: 'read_file', args: '{"path":"src/a.ts"}', finished: true, toolUseId: '1' },
        ], {
            ...deps,
            resolveStepDurationMs: (segmentIndex, segment) => (
                segment.type === 'thinking' && segmentIndex === 0 ? 1500 : segmentIndex === 1 ? 2400 : undefined
            ),
        }, true);
        expect(items[0]?.durationMs).to.equal(1500);
        expect(items[1]?.durationMs).to.equal(2400);
        const grouped = groupTranscriptActivityNavigationItems(items);
        expect(grouped[0]?.durationMs).to.equal(3900);
    });

    it('dedupes identical consecutive thinking content when grouping', () => {
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'thinking', content: 'Same plan' },
            { type: 'thinking', content: 'Same plan' },
            { type: 'thinking', content: 'Different plan' },
        ], deps, true);
        const grouped = groupTranscriptActivityNavigationItems(items);
        expect(grouped).to.have.length(1);
        expect(grouped[0]?.groupCount).to.equal(3);
        expect(grouped[0]?.thinkingContent).to.equal('Same plan\n\nDifferent plan');
    });

    it('groups consecutive finished reads into a single timeline row', () => {
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'tool', name: 'read_file', args: '{"path":"src/a.ts"}', finished: true, toolUseId: '1' },
            { type: 'tool', name: 'read_file', args: '{"path":"src/b.ts"}', finished: true, toolUseId: '2' },
            { type: 'tool', name: 'read_file', args: '{"path":"src/c.ts"}', finished: true, toolUseId: '3' },
            { type: 'tool', name: 'bash', args: '{"command":"npm test"}', finished: true, toolUseId: '4' },
        ], deps, false);
        const grouped = groupTranscriptActivityNavigationItems(items);
        expect(grouped).to.have.length(2);
        expect(grouped[0]?.grouped).to.equal(true);
        expect(grouped[0]?.groupCount).to.equal(3);
        expect(grouped[0]?.state).to.equal('success');
        expect(grouped[0]?.label).to.equal('Read 3 files');
        expect(grouped[0]?.navigate).to.equal('file');
        expect(grouped[0]?.filePath).to.equal('src/c.ts');
        expect(grouped[1]?.label).to.equal('Ran npm test');
    });

    it('groups consecutive finished shell commands around the latest command detail', () => {
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'tool', name: 'bash', args: '{"command":"ls -la /workspace"}', finished: true, toolUseId: '1' },
            { type: 'tool', name: 'bash', args: '{"command":"npm test"}', finished: true, toolUseId: '2' },
        ], deps, false);
        const grouped = groupTranscriptActivityNavigationItems(items);
        expect(grouped).to.have.length(1);
        expect(grouped[0]?.verb).to.equal('Ran');
        expect(grouped[0]?.detail).to.equal('npm test');
        expect(grouped[0]?.tail).to.equal('2 commands');
    });

    it('keeps running tools ungrouped while collapsing prior finished reads', () => {
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'tool', name: 'read_file', args: '{"path":"src/a.ts"}', finished: true, toolUseId: '1' },
            { type: 'tool', name: 'read_file', args: '{"path":"src/b.ts"}', finished: true, toolUseId: '2' },
            { type: 'tool', name: 'read_file', args: '{"path":"src/c.ts"}', finished: false, toolUseId: '3' },
        ], deps, false);
        const grouped = groupTranscriptActivityNavigationItems(items);
        expect(grouped).to.have.length(2);
        expect(grouped[0]?.grouped).to.equal(true);
        expect(grouped[0]?.groupCount).to.equal(2);
        expect(grouped[1]?.state).to.equal('running');
    });

    it('groups three or more consecutive running terminal commands', () => {
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'tool', name: 'bash', args: '{"command":"npm test"}', finished: false, toolUseId: '1' },
            { type: 'tool', name: 'bash', args: '{"command":"npm lint"}', finished: false, toolUseId: '2' },
            { type: 'tool', name: 'bash', args: '{"command":"npm build"}', finished: false, toolUseId: '3' },
        ], deps, false);
        const grouped = groupTranscriptActivityNavigationItems(items);
        expect(grouped).to.have.length(1);
        expect(grouped[0]?.grouped).to.equal(true);
        expect(grouped[0]?.groupCount).to.equal(3);
        expect(grouped[0]?.state).to.equal('running');
        expect(grouped[0]?.label).to.equal('Ran 3 commands');
    });

    it('groups consecutive finished edits for timeline expand', () => {
        const diff = '--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new\n+also';
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'tool', name: 'edit_file', args: '{"path":"foo.ts"}', finished: true, toolUseId: '1', result: diff },
            { type: 'tool', name: 'edit_file', args: '{"path":"bar.ts"}', finished: true, toolUseId: '2', result: diff },
        ], deps, false);
        const grouped = groupTranscriptActivityNavigationItems(items);
        expect(grouped).to.have.length(1);
        expect(grouped[0]?.grouped).to.equal(true);
        expect(grouped[0]?.groupCount).to.equal(2);
        expect(grouped[0]?.label).to.equal('Edited 2 files');
    });

    it('parses git-style edit summaries when no unified diff is present', () => {
        const items = resolveTranscriptActivityNavigationItems([
            {
                type: 'tool',
                name: 'edit_file',
                args: '{"path":"qaap-agent-conversation-list-metrics.spec.ts"}',
                finished: true,
                toolUseId: '1',
                result: '1 file changed, 1 insertion(+), 1 deletion(-)',
            },
        ], deps, false);
        expect(items[0]?.editAdded).to.equal(1);
        expect(items[0]?.editRemoved).to.equal(1);
        expect(items[0]?.verb).to.equal('Edited');
    });

    it('estimates edit stats from old_string / new_string args when result has no diff', () => {
        const items = resolveTranscriptActivityNavigationItems([
            {
                type: 'tool',
                name: 'edit_file',
                args: JSON.stringify({
                    path: 'en.ts',
                    old_string: 'hello',
                    new_string: 'hello\nworld',
                }),
                finished: true,
                toolUseId: '1',
                result: 'ok',
            },
        ], deps, false);
        expect(items[0]?.editAdded).to.equal(2);
        expect(items[0]?.editRemoved).to.equal(1);
    });

    it('uses streaming state for the writing step while the turn is live', () => {
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'tool', name: 'read_file', args: '{"path":"src/a.ts"}', finished: true, toolUseId: '1' },
            { type: 'text', content: 'Here is the answer.' },
        ], deps, false, { streaming: true });
        expect(items.at(-1)?.state).to.equal('streaming');
    });

    it('prefers planning or active tools over a short text preamble while streaming', () => {
        const preamble = resolveTranscriptActivityNavigationItems([
            { type: 'text', content: "I'll" },
        ], deps, false, { streaming: true });
        expect(preamble).to.have.length(1);
        expect(preamble[0]?.label).to.equal('Planning next steps');
        expect(preamble[0]?.state).to.equal('running');

        const withTool = resolveTranscriptActivityNavigationItems([
            { type: 'text', content: "I'll" },
            { type: 'tool', name: 'read_file', args: '{"path":"src/a.ts"}', finished: false, toolUseId: '1' },
        ], deps, false, { streaming: true });
        expect(withTool).to.have.length(2);
        expect(withTool[0]?.state).to.equal('running');
        expect(withTool[1]?.label).to.equal('Preparing the response');
        expect(withTool[1]?.state).to.equal('waiting');
    });

    it('propagates tool durationMs from resolveStepDurationMs', () => {
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'tool', name: 'read_file', args: '{"path":"src/a.ts"}', finished: true, toolUseId: '1' },
        ], {
            ...deps,
            resolveStepDurationMs: () => 2100,
        }, false);
        expect(items[0]?.durationMs).to.equal(2100);
    });

    it('attaches read result preview for finished read tools', () => {
        const items = resolveTranscriptActivityNavigationItems([
            {
                type: 'tool',
                name: 'read_file',
                args: '{"path":"store.tsx"}',
                finished: true,
                toolUseId: '1',
                result: 'export const StoreContext = createContext(null);',
            },
        ], deps, false);
        expect(items[0]?.resultPreview).to.equal('export const StoreContext = createContext(null);');
    });

    it('resolveTranscriptLifecycleActivityItems maps run_cancelled and error rows, skipping checkpoints', () => {
        const items = resolveTranscriptLifecycleActivityItems([
            {
                type: 'checkpoint',
                id: 'cp-1',
                label: 'After refactor',
                commit: 'abc123',
                capturedAt: 100,
                added: 3,
                removed: 1,
            },
            {
                type: 'run_cancelled',
                id: 'cancel-1',
                message: 'Turn cancelled.',
                startedAt: 200,
            },
            {
                type: 'error',
                id: 'preview-1',
                message: 'Run/preview failed: no package.json in the workspace root.',
                startedAt: 300,
            },
        ]);
        expect(items).to.have.length(2);
        expect(items[0]?.state).to.equal('cancelled');
        expect(items[0]?.label).to.equal('Turn cancelled.');
        expect(items[1]?.state).to.equal('error');
        expect(items[1]?.label).to.include('package.json');
    });
});
