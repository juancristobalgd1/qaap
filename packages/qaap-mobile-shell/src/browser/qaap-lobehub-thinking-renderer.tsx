// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * LobeHub-style thinking / reasoning block renderer for the QAAQ transcript.
 *
 * Re-implements the visual language of LobeHub's
 * `features/Conversation/components/Thinking` (Accordion + StatusIndicator
 * with Loader2Icon while thinking / AtomIcon when settled + Title with shiny
 * "Deep Thinking..." / "Deeply Thought" + ScrollArea with markdown content)
 * on top of QAAQ's existing `ThinkingChatResponseContent` model.
 * No parallel state.
 *
 * Priority 11 wins over the upstream `ThinkingPartRenderer` (10).
 */

import { ChatResponsePartRenderer } from '@theia/ai-chat-ui/lib/browser/chat-response-part-renderer';
import { MarkdownRender } from '@theia/ai-chat-ui/lib/browser/chat-response-renderer/markdown-part-renderer';
import { ChatResponseContent, ThinkingChatResponseContent } from '@theia/ai-chat/lib/common';
import { codicon, OpenerService } from '@theia/core/lib/browser';
import { nls } from '@theia/core/lib/common/nls';
import { inject, injectable } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { ReactNode } from '@theia/core/shared/react';

@injectable()
export class QaapLobehubThinkingRenderer implements ChatResponsePartRenderer<ThinkingChatResponseContent> {

    @inject(OpenerService)
    protected openerService: OpenerService;

    canHandle(response: ChatResponseContent): number {
        if (ThinkingChatResponseContent.is(response)) {
            return 11;
        }
        return -1;
    }

    render(response: ThinkingChatResponseContent): ReactNode {
        return <LobehubThinking content={response.content} openerService={this.openerService} />;
    }
}

interface LobehubThinkingProps {
    content: string;
    openerService: OpenerService;
}

/**
 * LobeHub-style thinking block.
 *
 * LobeHub's `Thinking` component (src/features/Conversation/components/Thinking):
 *   - StatusIndicator: Loader2Icon (spin) while thinking, AtomIcon when settled
 *     (purple when expanded, colorTextDescription when collapsed)
 *   - Title: shiny "Deep Thinking..." while thinking, "Deeply Thought" when settled
 *   - Accordion open while thinking, auto-collapses on settle; user can re-open
 *   - Content: markdown rendered inside a ScrollArea (max-height min(40vh, 320px))
 *
 * QAAQ's `ThinkingChatResponseContent` is a settled snapshot with no explicit
 * "thinking now" signal — we treat empty content as "thinking" (streaming)
 * and non-empty as "thought" (settled), matching LobeHub's auto behaviour.
 */
const LobehubThinking: React.FC<LobehubThinkingProps> = ({ content, openerService }) => {
    const hasContent = !!content && content.trim() !== '';
    const isThinking = !hasContent;

    // LobeHub i18n keys (packages/locales/src/default/components.ts):
    //   'Thinking.thinking': 'Deep Thinking...'
    //   'Thinking.thoughtWithDuration': 'Deeply Thought'
    //   'Thinking.thought': 'Deeply Thought (in {{duration}} seconds)'
    // QAAQ has no wall-clock duration on the snapshot, so we use
    // thoughtWithDuration (the no-duration variant).
    const thinkingLabel = isThinking
        ? nls.localize('qaap/lobehub/thinking/thinking', 'Deep Thinking...')
        : nls.localize('qaap/lobehub/thinking/thought', 'Deeply Thought');

    // Open while thinking (streaming), auto-collapse once settled — mirrors
    // LobeHub's `useEffect(() => setShowDetail(!!thinking), [thinking])`.
    const [open, setOpen] = React.useState(isThinking);
    React.useEffect(() => {
        if (hasContent) {
            setOpen(false);
        }
    }, [hasContent]);

    // LobeHub StatusIndicator: Loader2Icon (spin) while thinking,
    // AtomIcon when settled. Codicon equivalents: loading (spin) / lightbulb.
    const statusState = 'thinking';
    const statusIcon = isThinking
        ? <span className={`${codicon('loading')} theia-animation-spin`} />
        : <span className={codicon('lightbulb')} />;

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
                        <span className={`qaap-lh-thinkingLabel ${isThinking ? 'qaap-lh-shiny' : ''}`}>
                            {thinkingLabel}
                        </span>
                    </span>
                </summary>
                <div className='qaap-lh-thinking-content'>
                    <MarkdownRender text={content} openerService={openerService} />
                </div>
            </details>
        </div>
    );
};
