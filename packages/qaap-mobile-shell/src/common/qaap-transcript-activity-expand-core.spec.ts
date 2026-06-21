// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';
import {
    resolveTranscriptActivityExpandBody,
    resolveTranscriptActivityExpandContent,
    shouldShowTranscriptActivityExpand,
    shouldShowTranscriptActivityExpandContent,
    type TranscriptActivityExpandDeps,
} from './qaap-transcript-activity-expand-core';

const deps: TranscriptActivityExpandDeps = {
    extractToolPath: args => {
        try {
            const parsed = JSON.parse(args) as { path?: string };
            return parsed.path;
        } catch {
            return undefined;
        }
    },
    extractToolCommand: args => {
        try {
            const parsed = JSON.parse(args) as { command?: string };
            return parsed.command;
        } catch {
            return undefined;
        }
    },
    formatToolLabel: (toolName, args) => `${toolName} ${args}`,
};

describe('qaap-transcript-activity-expand-core', () => {

    const segments: QaapAgentMessageSegmentDTO[] = [
        {
            type: 'tool',
            name: 'Bash',
            toolUseId: 't1',
            args: JSON.stringify({ command: 'ls -la /workspace' }),
            result: 'ok',
            finished: true,
        },
        {
            type: 'tool',
            name: 'Bash',
            toolUseId: 't2',
            args: JSON.stringify({ command: 'npm test' }),
            result: 'ok',
            finished: true,
        },
        {
            type: 'tool',
            name: 'Read',
            toolUseId: 't3',
            args: JSON.stringify({ path: 'package.json' }),
            result: '{\n  "name": "qaap"\n}',
            finished: true,
        },
        {
            type: 'tool',
            name: 'Bash',
            toolUseId: 't4',
            args: JSON.stringify({ command: 'echo hello' }),
            result: 'hello\n',
            finished: true,
        },
    ];

    it('resolveTranscriptActivityExpandContent lists grouped terminal commands with stdout', () => {
        const item: TranscriptActivityNavigationItem = {
            label: 'Ran 2 commands',
            state: 'success',
            toolKind: 'terminal',
            grouped: true,
            groupCount: 2,
            segmentIndices: [0, 1],
            navigate: 'terminal',
        };
        const content = resolveTranscriptActivityExpandContent(item, segments, deps);
        expect(content).to.deep.equal({
            kind: 'terminal-group',
            entries: [
                { command: 'ls -la /workspace', output: undefined, finished: true },
                { command: 'npm test', output: undefined, finished: true },
            ],
        });
        expect(shouldShowTranscriptActivityExpandContent(item, content)).to.equal(true);
        const body = resolveTranscriptActivityExpandBody(item, segments, deps);
        expect(body).to.equal('ls -la /workspace\n\nnpm test');
        expect(shouldShowTranscriptActivityExpand(item, body)).to.equal(true);
    });

    it('resolveTranscriptActivityExpandContent returns full read results when longer than preview', () => {
        const item: TranscriptActivityNavigationItem = {
            label: 'Read package.json',
            state: 'success',
            toolKind: 'reading',
            segmentIndex: 2,
            resultPreview: '{\n  "name": "qaap"\n}',
            navigate: 'file',
            filePath: 'package.json',
        };
        const content = resolveTranscriptActivityExpandContent(item, segments, deps);
        expect(content).to.deep.equal({
            kind: 'read',
            entry: { path: 'package.json', text: '{\n  "name": "qaap"\n}' },
        });
        expect(shouldShowTranscriptActivityExpandContent(item, content)).to.equal(false);
        const body = resolveTranscriptActivityExpandBody(item, segments, deps);
        expect(body).to.equal('{\n  "name": "qaap"\n}');
        expect(shouldShowTranscriptActivityExpand(item, body)).to.equal(false);
    });

    it('resolveTranscriptActivityExpandContent exposes todo checklist items', () => {
        const todoSegments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'TodoWrite',
                toolUseId: 'todo-1',
                args: JSON.stringify({
                    todos: [
                        { content: 'Wire expand UI', status: 'completed' },
                        { content: 'Polish error panel', status: 'in_progress' },
                    ],
                }),
                result: 'ok',
                finished: true,
            },
        ];
        const item: TranscriptActivityNavigationItem = {
            label: 'Updated todo list',
            verb: 'Updated',
            detail: 'todo list',
            state: 'success',
            toolKind: 'todo',
            segmentIndex: 0,
        };
        const content = resolveTranscriptActivityExpandContent(item, todoSegments, deps);
        expect(content).to.deep.equal({
            kind: 'todo',
            items: [
                { label: 'Wire expand UI', status: 'completed' },
                { label: 'Polish error panel', status: 'in_progress' },
            ],
        });
        expect(shouldShowTranscriptActivityExpandContent(item, content)).to.equal(true);
    });

    it('resolveTranscriptActivityExpandContent groups consecutive edits into edit-group', () => {
        const editSegments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'edit_file',
                toolUseId: 'e1',
                args: JSON.stringify({ path: 'foo.ts' }),
                result: '1 file changed, 1 insertion(+)',
                finished: true,
            },
            {
                type: 'tool',
                name: 'edit_file',
                toolUseId: 'e2',
                args: JSON.stringify({ path: 'bar.ts' }),
                result: '1 file changed, 2 insertions(+), 1 deletion(-)',
                finished: true,
            },
        ];
        const item: TranscriptActivityNavigationItem = {
            label: 'Edited 2 files',
            state: 'success',
            toolKind: 'editing',
            grouped: true,
            groupCount: 2,
            segmentIndices: [0, 1],
        };
        const content = resolveTranscriptActivityExpandContent(item, editSegments, deps);
        expect(content).to.deep.equal({
            kind: 'edit-group',
            entries: [{ path: 'foo.ts' }, { path: 'bar.ts' }],
        });
        expect(shouldShowTranscriptActivityExpandContent(item, content)).to.equal(true);
    });

    it('resolveTranscriptActivityExpandContent exposes compact grep matches', () => {
        const grepSegments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                name: 'Grep',
                toolUseId: 'grep-1',
                args: JSON.stringify({ pattern: 'resolvePinned' }),
                result: [
                    'Found 1 matching line',
                    'packages/qaap-mobile-shell/src/browser/foo.ts:42:  return resolvePinnedEditorContextVariable(',
                ].join('\n'),
                finished: true,
            },
        ];
        const item: TranscriptActivityNavigationItem = {
            label: 'Grepped resolvePinned',
            state: 'success',
            toolKind: 'searching',
            segmentIndex: 0,
        };
        const content = resolveTranscriptActivityExpandContent(item, grepSegments, deps);
        expect(content).to.deep.equal({
            kind: 'search-matches',
            matches: [{
                file: 'src/browser/foo.ts',
                line: 42,
                snippet: 'return resolvePinnedEditorContextVariable(',
            }],
        });
        expect(shouldShowTranscriptActivityExpandContent(item, content)).to.equal(true);
    });

    it('resolveTranscriptActivityExpandContent exposes a shell command with stdout', () => {
        const item: TranscriptActivityNavigationItem = {
            label: 'Ran command',
            state: 'success',
            toolKind: 'terminal',
            segmentIndex: 3,
            detail: 'echo hello',
            navigate: 'terminal',
        };
        const content = resolveTranscriptActivityExpandContent(item, segments, deps);
        expect(content).to.deep.equal({
            kind: 'terminal',
            entry: { command: 'echo hello', output: 'hello', finished: true },
        });
        expect(shouldShowTranscriptActivityExpandContent(item, content)).to.equal(true);
        const body = resolveTranscriptActivityExpandBody(item, segments, deps);
        expect(body).to.equal('echo hello\n\nhello');
        expect(shouldShowTranscriptActivityExpand(item, body)).to.equal(true);
    });
});
