// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

import { expect } from 'chai';
import {
    MarkdownChatResponseContentImpl,
    TextChatResponseContentImpl,
    ThinkingChatResponseContentImpl,
    ToolCallChatResponseContentImpl,
} from '@theia/ai-chat/lib/common';
import { OpenerService } from '@theia/core/lib/browser';
import { createRoot } from '@theia/core/shared/react-dom/client';
import { flushSync } from '@theia/core/shared/react-dom';
import * as React from '@theia/core/shared/react';
import { QaapLobehubThinkingRenderer } from './qaap-lobehub-thinking-renderer';

const mockOpenerService = {} as OpenerService;

function createRenderer(): QaapLobehubThinkingRenderer {
    const renderer = new QaapLobehubThinkingRenderer();
    (renderer as unknown as { openerService: OpenerService }).openerService = mockOpenerService;
    return renderer;
}

function renderToContainer(node: React.ReactNode): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => root.render(<>{node}</>));
    return { container, root };
}

describe('qaap-lobehub-thinking-renderer', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    describe('canHandle priority', () => {
        const renderer = createRenderer();

        it('claims ThinkingChatResponseContent with priority 11', () => {
            const content = new ThinkingChatResponseContentImpl('thought', 'sig');
            expect(renderer.canHandle(content)).to.equal(11);
        });

        it('returns -1 for non-thinking content kinds', () => {
            const text = new TextChatResponseContentImpl('hello');
            const markdown = new MarkdownChatResponseContentImpl('# hi');
            const tool = new ToolCallChatResponseContentImpl('id', 'tool', '{}', false);
            expect(renderer.canHandle(text)).to.equal(-1);
            expect(renderer.canHandle(markdown)).to.equal(-1);
            expect(renderer.canHandle(tool)).to.equal(-1);
        });
    });

    describe('render', () => {
        it('renders the thinking accordion with the streaming label when content is empty', () => {
            const renderer = createRenderer();
            const content = new ThinkingChatResponseContentImpl('', '');
            const { container, root } = renderToContainer(renderer.render(content));

            const block = container.querySelector('.qaap-lh-thinking');
            expect(block, 'thinking block should render').to.exist;
            // Empty content -> open by default so the user sees the live trace.
            expect(container.querySelector('details')?.hasAttribute('open')).to.equal(true);
            // Shiny streaming class applied while thinking.
            expect(container.querySelector('.qaap-lh-shiny')).to.exist;
            // Spinner (loading) icon for in-progress thinking — LobeHub uses Loader2Icon.
            const statusIcon = container.querySelector('.qaap-lh-statusBlock .codicon');
            expect(statusIcon?.className).to.contain('codicon-loading');
            expect(container.querySelector('.qaap-lh-statusBlock')?.getAttribute('data-state')).to.equal('thinking');
            // Label is "Deep Thinking..." (LobeHub Thinking.thinking).
            expect(container.querySelector('.qaap-lh-thinkingLabel')?.textContent).to.contain('Deep Thinking');

            flushSync(() => root.unmount());
        });

        it('collapses once reasoning settles and shows the settled label', () => {
            const renderer = createRenderer();
            const content = new ThinkingChatResponseContentImpl('I considered the options.', 'sig');
            const { container, root } = renderToContainer(renderer.render(content));

            // Settled content -> auto-collapse effect runs.
            const details = container.querySelector('details.qaap-lh-thinking-accordion');
            expect(details, 'thinking accordion should render').to.exist;
            // The lightbulb icon is used for settled thinking — LobeHub uses AtomIcon.
            const statusIcon = details!.querySelector('.qaap-lh-statusBlock .codicon');
            expect(statusIcon?.className).to.contain('codicon-lightbulb');
            // Shiny streaming class is NOT applied once content is present.
            expect(details!.querySelector('.qaap-lh-shiny')).to.not.exist;
            // Label is "Deeply Thought" (LobeHub Thinking.thoughtWithDuration).
            expect(details!.querySelector('.qaap-lh-thinkingLabel')?.textContent).to.contain('Deeply Thought');

            flushSync(() => root.unmount());
        });

        it('renders the reasoning text inside the content block when expanded', () => {
            const renderer = createRenderer();
            const content = new ThinkingChatResponseContentImpl('Step 1: analyze.\nStep 2: act.', 'sig');
            const { container, root } = renderToContainer(renderer.render(content));

            // Force-open the details to inspect the content block.
            const details = container.querySelector('details.qaap-lh-thinking-accordion')!;
            details.setAttribute('open', '');
            flushSync(() => { /* re-render after attribute change */ });

            // Content is now rendered as markdown (MarkdownRender), not <pre>.
            const contentBlock = container.querySelector('.qaap-lh-thinking-content');
            expect(contentBlock?.textContent).to.contain('Step 1: analyze.');

            flushSync(() => root.unmount());
        });

        it('user manual toggle updates the open state', () => {
            const renderer = createRenderer();
            const content = new ThinkingChatResponseContentImpl('', '');
            const { container, root } = renderToContainer(renderer.render(content));

            const details = container.querySelector('details.qaap-lh-thinking-accordion') as HTMLDetailsElement;
            // Initially open (empty content).
            expect(details.hasAttribute('open')).to.equal(true);
            // Simulate user collapsing via the toggle event (React's onToggle handler).
            details.removeAttribute('open');
            details.dispatchEvent(new window.Event('toggle'));
            flushSync(() => { });
            expect(details.hasAttribute('open')).to.equal(false);

            flushSync(() => root.unmount());
        });
    });
});
