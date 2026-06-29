// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * LobeHub-style thinking / reasoning block renderer for the QAAQ transcript.
 *
 * Re-implements the visual language of LobeHub's
 * `Messages/components/Thinking` (StatusIndicator + Title with shiny
 * "Thinking..." / "Thought for Xs" + expandable scrollable content) on top of
 * QAAQ's existing `ThinkingChatResponseContent` model. No parallel state.
 *
 * Priority 11 wins over the upstream `ThinkingPartRenderer` (10).
 */

import { ChatResponsePartRenderer } from '@theia/ai-chat-ui/lib/browser/chat-response-part-renderer';
import { ChatResponseContent, ThinkingChatResponseContent } from '@theia/ai-chat/lib/common';
import { codicon } from '@theia/core/lib/browser';
import { nls } from '@theia/core/lib/common/nls';
import { injectable } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { ReactNode } from '@theia/core/shared/react';

@injectable()
export class QaapLobehubThinkingRenderer implements ChatResponsePartRenderer<ThinkingChatResponseContent> {

    canHandle(response: ChatResponseContent): number {
        if (ThinkingChatResponseContent.is(response)) {
            return 11;
        }
        return -1;
    }

    render(response: ThinkingChatResponseContent): ReactNode {
        return <LobehubThinking content={response.content} />;
    }
}

interface LobehubThinkingProps {
    content: string;
}

/**
 * LobeHub-style thinking block.
 *
 * While there is no explicit "thinking now" signal on the QAAQ content model
 * (the upstream `ThinkingChatResponseContent` is a settled snapshot), we treat
 * the presence of content as "thought" — matching LobeHub's completed-state
 * title "Thought for Xs". The block is collapsible; open by default when
 * empty (still streaming) so the user sees the live trace.
 */
const LobehubThinking: React.FC<LobehubThinkingProps> = ({ content }) => {
    const hasContent = !!content && content.trim() !== '';
    // No wall-clock duration is available on the content snapshot; LobeHub
    // shows "Thought for Xs" only when duration is known. We omit the duration
    // chip when unknown (LobeHub falls back to "Thought" without duration).
    const thinkingLabel = hasContent
        ? nls.localizeByDefault('Thought')
        : nls.localizeByDefault('Thinking');

    // Open while there is no content yet (streaming), collapsed once settled.
    const [open, setOpen] = React.useState(!hasContent);
    React.useEffect(() => {
        if (hasContent) {
            // Auto-collapse once the reasoning settles — mirrors LobeHub's
            // "expand while thinking, collapse after" auto behaviour. The user
            // can still re-open.
            setOpen(false);
        }
    }, [hasContent]);

    const statusState = 'thinking';
    const statusIcon = hasContent
        ? <span className={codicon('sparkle')} />
        : <span className={`${codicon('loading')} theia-animation-spin`} />;

    return (
        <div className='qaap-lh-thinking'>
            <details
                className='qaap-lh-thinking-accordion'
                open={open}
                onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
            >
                <summary>
                    <span className='qaap-lh-statusBlock' data-state={statusState}>{statusIcon}</span>
                    <span className='qaap-lh-thinkingTitle'>
                        <span className={`qaap-lh-thinkingLabel ${!hasContent ? 'qaap-lh-shiny' : ''}`}>
                            {thinkingLabel}
                        </span>
                    </span>
                </summary>
                <div className='qaap-lh-thinking-content'>
                    <pre>{content}</pre>
                </div>
            </details>
        </div>
    );
};
