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
import { formatToolDetailLabel, ToolGroupTimelineSegment } from './execution-timeline';

export interface ToolGroupTimelineItemProps {
    segment: ToolGroupTimelineSegment;
    hasPending: boolean;
    hasError: boolean;
    renderContent: (content: ToolCallChatResponseContent, index: number) => React.ReactNode;
}

export const ToolGroupTimelineItem: React.FC<ToolGroupTimelineItemProps> = ({ segment, hasPending, hasError, renderContent }) => (
    <details
        className={`theia-AgentToolGroup ${hasError ? 'failed' : ''} ${hasPending ? 'running' : 'finished'}`}
    >
        <summary className='theia-AgentToolGroup-Summary'>
            <span className={`codicon ${segment.icon}`}></span>
            <span className='theia-AgentToolGroup-Title'>{segment.label}</span>
            <span className='theia-AgentToolGroup-Meta'>{segment.summary}</span>
            <span className={`theia-AgentToolGroup-State ${hasError ? 'failed' : hasPending ? 'running' : 'complete'}`}>
                <span className={`codicon ${hasError ? 'codicon-error' : hasPending ? 'codicon-loading theia-animation-spin' : 'codicon-check'}`}></span>
            </span>
            <span className='codicon codicon-chevron-down theia-AgentToolGroup-Chevron'></span>
        </summary>
        <div className='theia-AgentToolGroup-Tree'>
            {segment.contents.map((content, index) =>
                <div className='theia-AgentToolGroup-TreeItem' key={content.id ?? `${segment.id}-tool-${index}`}>
                    <span className='theia-AgentToolGroup-Branch'>{formatToolDetailLabel(segment, index)}</span>
                    <div className='theia-AgentToolGroup-ToolCard'>
                        {renderContent(content, index)}
                    </div>
                </div>
            )}
        </div>
    </details>
);
