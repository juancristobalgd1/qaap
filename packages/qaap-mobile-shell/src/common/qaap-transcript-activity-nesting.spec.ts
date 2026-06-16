// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import {
    annotateTranscriptActivityNestMetadata,
    resolveTranscriptActivityNestDepth,
    transcriptActivityHasNestedChildren,
} from './qaap-transcript-activity-nesting';
import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';

describe('qaap-transcript-activity-nesting', () => {

    const segments: QaapAgentMessageSegmentDTO[] = [
        {
            type: 'tool',
            toolUseId: 'agent-1',
            name: 'Agent',
            args: '{}',
            finished: true,
        },
        {
            type: 'tool',
            toolUseId: 'read-1',
            name: 'Read',
            args: '{"path":"a.ts"}',
            finished: true,
            parentToolUseId: 'agent-1',
        },
        {
            type: 'tool',
            toolUseId: 'read-2',
            name: 'Read',
            args: '{"path":"b.ts"}',
            finished: true,
            parentToolUseId: 'agent-1',
        },
    ];

    it('detects nested children under a subagent tool', () => {
        expect(transcriptActivityHasNestedChildren('agent-1', segments)).to.equal(true);
        expect(transcriptActivityHasNestedChildren('read-1', segments)).to.equal(false);
    });

    it('computes nest depth from parent chain', () => {
        const parentMap = new Map([
            ['agent-1', undefined],
            ['read-1', 'agent-1'],
        ]);
        expect(resolveTranscriptActivityNestDepth(undefined, parentMap)).to.equal(0);
        expect(resolveTranscriptActivityNestDepth('agent-1', parentMap)).to.equal(1);
    });

    it('annotates navigation items with nest depth and subagent root', () => {
        const items: TranscriptActivityNavigationItem[] = [
            { label: 'Agent', state: 'success', segmentIndex: 0 },
            { label: 'Read a.ts', state: 'success', segmentIndex: 1 },
        ];
        const annotated = annotateTranscriptActivityNestMetadata(items, segments);
        expect(annotated[0]?.subagentRoot).to.equal(true);
        expect(annotated[0]?.nestDepth).to.equal(0);
        expect(annotated[1]?.nestDepth).to.equal(1);
        expect(annotated[1]?.parentToolUseId).to.equal('agent-1');
    });
});
