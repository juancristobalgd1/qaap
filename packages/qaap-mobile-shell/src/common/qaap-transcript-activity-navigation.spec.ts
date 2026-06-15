// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { groupTranscriptActivityNavigationItems, resolveTranscriptActivityNavigationItems } from './qaap-transcript-activity-navigation';

const deps = {
    localizeActivityLabel: (label: string) => label,
    formatToolActivityLabel: (toolName: string) => `Running: ${toolName}`,
    localizePlanningLabel: () => 'Planning next steps',
    localizeWritingLabel: () => 'Writing response',
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
        return 'tool';
    },
};

describe('qaap-transcript-activity-navigation', () => {

    it('maps tool segments to file and terminal navigation targets', () => {
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'tool', name: 'read_file', args: '{"path":"src/a.ts"}', finished: true, toolUseId: '1' },
            { type: 'tool', name: 'bash', args: '{"command":"npm test"}', finished: false, toolUseId: '2' },
        ], deps, false);
        expect(items).to.have.length(2);
        expect(items[0]?.navigate).to.equal('file');
        expect(items[0]?.filePath).to.equal('src/a.ts');
        expect(items[1]?.navigate).to.equal('terminal');
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
});
