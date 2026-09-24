// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    resolveTranscriptSubagentCardModels,
    transcriptActivitySubagentCardClassName,
} from './qaap-transcript-activity-subagent-card';
import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';

describe('resolveTranscriptSubagentCardModels', () => {
    it('exports the subagent card class name', () => {
        expect(transcriptActivitySubagentCardClassName).to.equal('theia-mod-subagent-card');
    });

    it('collects nested children until depth returns to root', () => {
        const items: TranscriptActivityNavigationItem[] = [
            { label: 'root', state: 'success', subagentRoot: true, nestDepth: 0, detail: 'Inspect UI' },
            { label: 'child read', state: 'success', nestDepth: 1 },
            { label: 'child edit', state: 'success', nestDepth: 1 },
            { label: 'next root', state: 'success', nestDepth: 0 },
        ];
        const models = resolveTranscriptSubagentCardModels(items);
        expect(models).to.have.length(1);
        expect(models[0]).to.deep.equal({
            rootIndex: 0,
            childIndexes: [1, 2],
            title: 'Inspect UI',
            nestDepth: 0,
        });
    });

    it('stops at the next subagent root at the same depth', () => {
        const items: TranscriptActivityNavigationItem[] = [
            { label: 'first', state: 'success', subagentRoot: true, nestDepth: 1, detail: 'Task A' },
            { label: 'nested', state: 'success', nestDepth: 2 },
            { label: 'second', state: 'success', subagentRoot: true, nestDepth: 1, detail: 'Task B' },
            { label: 'nested b', state: 'success', nestDepth: 2 },
        ];
        const models = resolveTranscriptSubagentCardModels(items);
        expect(models).to.have.length(2);
        expect(models[0]!.childIndexes).to.deep.equal([1]);
        expect(models[1]!.childIndexes).to.deep.equal([3]);
    });
});
