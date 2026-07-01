// *****************************************************************************
// Copyright (C) 2026 EclipseSource GmbH.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the
// Eclipse Public License v. 2.0 are satisfied: GNU General Public License,
// version 2 with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ChatResponseContent, ToolCallChatResponseContent } from '@theia/ai-chat';
import { expect } from 'chai';
import { buildExecutionTimeline, formatToolDetailLabel, ToolGroupTimelineSegment } from './execution-timeline';

describe('buildExecutionTimeline', () => {

    it('groups consecutive tool calls by user-facing activity', () => {
        const timeline = buildExecutionTimeline([
            toolCall('read_file'),
            toolCall('read_file'),
            toolCall('bash')
        ]);

        expect(timeline.map(segment => segment.kind)).to.deep.equal([
            'narrative',
            'toolGroup',
            'narrative',
            'toolGroup'
        ]);
        expect(toolGroups(timeline).map(group => [group.label, group.summary])).to.deep.equal([
            ['Read', '2 files'],
            ['Run', '1 command']
        ]);
    });

    it('keeps authored narrative as the primary timeline content', () => {
        const narrative = textContent("I'm inspecting the repository.");
        const timeline = buildExecutionTimeline([
            narrative,
            toolCall('grep'),
            toolCall('grep')
        ]);

        expect(timeline[0]).to.include({ kind: 'narrative', content: narrative });
        expect(timeline[1]).to.include({ kind: 'toolGroup', label: 'Explore', summary: '2 searches' });
    });

    it('inserts narrative between adjacent tool groups', () => {
        const timeline = buildExecutionTimeline([
            toolCall('grep'),
            toolCall('bash'),
            toolCall('edit_file')
        ]);

        expect(timeline.map(segment => segment.kind)).to.deep.equal([
            'narrative',
            'toolGroup',
            'narrative',
            'toolGroup',
            'narrative',
            'toolGroup'
        ]);
        expect(timeline.filter(segment => segment.kind === 'narrative' && segment.synthetic)).to.have.length(3);
    });

    it('labels expanded technical rows generically instead of exposing tool names first', () => {
        const group = toolGroups(buildExecutionTimeline([
            toolCall('bash'),
            toolCall('shell_exec')
        ]))[0];

        expect(formatToolDetailLabel(group, 0)).to.equal('Command 1');
        expect(formatToolDetailLabel(group, 1)).to.equal('Command 2');
    });

    it('promotes test and lint commands into verification instead of generic run groups', () => {
        const timeline = buildExecutionTimeline([
            toolCall('bash', '{"command":"npm run test"}'),
            toolCall('shell_exec', '{"cmd":"pnpm lint"}'),
            toolCall('vitest')
        ]);

        expect(toolGroups(timeline).map(group => [group.label, group.summary, group.detailLabel])).to.deep.equal([
            ['Verification', '3 checks', 'Check']
        ]);
    });

    it('keeps generic shell commands as run groups', () => {
        const timeline = buildExecutionTimeline([
            toolCall('bash', '{"command":"npm install"}')
        ]);

        expect(toolGroups(timeline).map(group => [group.label, group.summary])).to.deep.equal([
            ['Run', '1 command']
        ]);
    });

});

function toolGroups(timeline: ReturnType<typeof buildExecutionTimeline>): ToolGroupTimelineSegment[] {
    return timeline.filter((segment): segment is ToolGroupTimelineSegment => segment.kind === 'toolGroup');
}

function toolCall(name: string, args?: string): ToolCallChatResponseContent {
    return {
        kind: 'toolCall',
        name,
        arguments: args,
        finished: true
    } as ToolCallChatResponseContent;
}

function textContent(content: string): ChatResponseContent {
    return {
        kind: 'text',
        asString: () => content
    } as ChatResponseContent;
}
