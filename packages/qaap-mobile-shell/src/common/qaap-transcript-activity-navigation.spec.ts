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
    localizeWritingLabel: () => 'Writing response',
    localizeFailedLabel: (detail: string) => `Failed: ${detail}`,
    extractToolPath: (argsJson: string) => {
        try {
            const args = JSON.parse(argsJson) as { path?: string };
            return args.path;
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
        expect(items[1]?.label).to.equal('Retrying: Running: bash');
        expect(items[1]?.recoverySummary).to.equal('Retrying after: Error: port in use');
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
        expect(grouped[1]?.label).to.equal('Running: bash');
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

    it('keeps consecutive edits separate with diff stats for cursor trace rows', () => {
        const diff = '--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new\n+also';
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'tool', name: 'edit_file', args: '{"path":"foo.ts"}', finished: true, toolUseId: '1', result: diff },
            { type: 'tool', name: 'edit_file', args: '{"path":"bar.ts"}', finished: true, toolUseId: '2', result: diff },
        ], deps, false);
        const grouped = groupTranscriptActivityNavigationItems(items);
        expect(grouped).to.have.length(2);
        expect(grouped[0]?.verb).to.equal('Edited');
        expect(grouped[0]?.detail).to.equal('foo.ts');
        expect(grouped[0]?.editAdded).to.be.greaterThan(0);
        expect(grouped[0]?.editRemoved).to.be.greaterThan(0);
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
        expect(withTool[1]?.label).to.equal('Writing response');
        expect(withTool[1]?.state).to.equal('waiting');
    });

    it('resolveTranscriptLifecycleActivityItems maps checkpoint and run_cancelled rows', () => {
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
        ]);
        expect(items).to.have.length(2);
        expect(items[0]?.state).to.equal('success');
        expect(items[0]?.label).to.include('Checkpoint: After refactor');
        expect(items[0]?.label).to.include('+3/-1');
        expect(items[1]?.state).to.equal('cancelled');
        expect(items[1]?.label).to.equal('Turn cancelled.');
    });
});
