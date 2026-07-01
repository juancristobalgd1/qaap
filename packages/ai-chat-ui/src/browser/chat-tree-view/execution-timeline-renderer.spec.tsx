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

import { ToolCallChatResponseContent } from '@theia/ai-chat';
import * as React from '@theia/core/shared/react';
import { expect } from 'chai';
import { ToolGroupTimelineSegment } from './execution-timeline';
import { ToolGroupTimelineItem } from './execution-timeline-renderer';

describe('ToolGroupTimelineItem', () => {

    it('renders collapsed technical details by default', () => {
        const element = ToolGroupTimelineItem({
            segment: group('Run', '2 commands', 'Command'),
            hasPending: false,
            hasError: false,
            renderContent: () => React.createElement('span', undefined, 'technical detail')
        }) as React.ReactElement;

        expect(element.type).to.equal('details');
        expect(element.props).not.to.have.property('open');
    });

    it('keeps the collapsed summary limited to icon, name, summary, state, and chevron', () => {
        const element = ToolGroupTimelineItem({
            segment: group('Read', '2 files', 'File'),
            hasPending: false,
            hasError: false,
            renderContent: () => React.createElement('span', undefined, 'technical detail')
        }) as React.ReactElement;

        const summary = React.Children.toArray(element.props.children)[0] as React.ReactElement;
        expect(summary.type).to.equal('summary');
        expect(React.Children.count(summary.props.children)).to.equal(5);
    });

});

function group(label: string, summary: string, detailLabel: string): ToolGroupTimelineSegment {
    return {
        kind: 'toolGroup',
        id: `${label}-${summary}`,
        label,
        summary,
        icon: 'codicon-terminal',
        detailLabel,
        contents: [
            toolCall(`${label}-1`),
            toolCall(`${label}-2`)
        ]
    };
}

function toolCall(name: string): ToolCallChatResponseContent {
    return {
        kind: 'toolCall',
        name,
        finished: true
    } as ToolCallChatResponseContent;
}
