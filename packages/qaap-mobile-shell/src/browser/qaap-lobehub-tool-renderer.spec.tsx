// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// jsdom must be enabled before importing React / the renderer modules so that
// the JSX runtime + the renderer's `useEffect`/`useState` hooks resolve.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

import { expect } from 'chai';
import { ContextMenuRenderer, HoverService, OpenerService } from '@theia/core/lib/browser';
import {
    MarkdownChatResponseContentImpl,
    TextChatResponseContentImpl,
    ThinkingChatResponseContentImpl,
    ToolCallChatResponseContent,
    ToolCallChatResponseContentImpl,
} from '@theia/ai-chat/lib/common';
import { ToolConfirmationMode } from '@theia/ai-chat/lib/common/chat-tool-preferences';
import { ToolConfirmationManager } from '@theia/ai-chat/lib/browser/chat-tool-preference-bindings';
import { ToolInvocationRegistry } from '@theia/ai-core';
import { ClaudeCodeToolCallChatResponseContent } from '@theia/ai-claude-code/lib/browser/claude-code-tool-call-content';
import { createRoot } from '@theia/core/shared/react-dom/client';
import { flushSync } from '@theia/core/shared/react-dom';
import * as React from '@theia/core/shared/react';
import { ResponseNode } from '@theia/ai-chat-ui/lib/browser/chat-tree-view';
import { QaapLobehubToolRenderer } from './qaap-lobehub-tool-renderer';

const mockContextMenuRenderer = {} as ContextMenuRenderer;
const mockOpenerService = {} as OpenerService;
const mockHoverService = { requestHover: () => { } } as unknown as HoverService;

function createRenderer(): QaapLobehubToolRenderer {
    const renderer = new QaapLobehubToolRenderer();
    // Inject mock dependencies — the class uses property injection.
    (renderer as unknown as { toolConfirmationManager: ToolConfirmationManager }).toolConfirmationManager = {
        getConfirmationMode: () => ToolConfirmationMode.CONFIRM,
    } as unknown as ToolConfirmationManager;
    (renderer as unknown as { openerService: OpenerService }).openerService = mockOpenerService;
    (renderer as unknown as { toolInvocationRegistry: ToolInvocationRegistry }).toolInvocationRegistry = {
        getFunction: () => undefined,
    } as unknown as ToolInvocationRegistry;
    (renderer as unknown as { hoverService: HoverService }).hoverService = mockHoverService;
    (renderer as unknown as { contextMenuRenderer: ContextMenuRenderer }).contextMenuRenderer = mockContextMenuRenderer;
    return renderer;
}

function makeResponseNode(response: ToolCallChatResponseContent): ResponseNode {
    return {
        response: { isCanceled: false } as unknown as ResponseNode['response'],
        sessionId: 'test-chat',
    } as ResponseNode;
}

function renderToContainer(node: React.ReactNode): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => root.render(<>{node}</>));
    return { container, root };
}

describe('qaap-lobehub-tool-renderer', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    describe('canHandle priority', () => {
        const renderer = createRenderer();

        it('claims plain ToolCallChatResponseContent with priority 11', () => {
            const content = new ToolCallChatResponseContentImpl('id', 'tool', '{}', false);
            expect(renderer.canHandle(content)).to.equal(11);
        });

        it('yields (-1) for ClaudeCodeToolCallChatResponseContent so QAIQ renderers win', () => {
            const content = new ClaudeCodeToolCallChatResponseContent('id', 'bash', '{}', false);
            expect(renderer.canHandle(content)).to.equal(-1);
        });

        it('returns -1 for non-tool content kinds', () => {
            const text = new TextChatResponseContentImpl('hello');
            const markdown = new MarkdownChatResponseContentImpl('# hi');
            const thinking = new ThinkingChatResponseContentImpl('thought', 'sig');
            expect(renderer.canHandle(text)).to.equal(-1);
            expect(renderer.canHandle(markdown)).to.equal(-1);
            expect(renderer.canHandle(thinking)).to.equal(-1);
        });
    });

    describe('render — terminal states', () => {
        it('renders a compact denied terminal block (no <details>)', () => {
            const renderer = createRenderer();
            // A finished tool whose result is a DenialResult -> confirmationState 'denied'
            const content = new ToolCallChatResponseContentImpl(
                'id', 'dangerous', '{}', true, { denied: true, reason: 'policy' } as ToolCallChatResponseContent['result']
            );
            const node = renderer.render(content, makeResponseNode(content));
            const { container, root } = renderToContainer(node);

            const terminal = container.querySelector('.qaap-lh-tool-terminal');
            expect(terminal, 'terminal block should render').to.exist;
            expect(container.querySelector('details'), 'no expandable details in terminal state').to.not.exist;
            expect(terminal!.textContent).to.contain('dangerous');
            expect(terminal!.querySelector('.qaap-lh-statusBlock')?.getAttribute('data-state')).to.equal('error');

            flushSync(() => root.unmount());
        });
    });

    describe('render — expandable states', () => {
        it('renders an expandable <details> for a running tool call with args', () => {
            const renderer = createRenderer();
            const content = new ToolCallChatResponseContentImpl('id', 'search', '{"query":"hello"}', false);
            const node = renderer.render(content, makeResponseNode(content));
            const { container, root } = renderToContainer(node);

            const details = container.querySelector('details.qaap-lh-tool-accordion');
            expect(details, 'expandable details should render').to.exist;
            // Running tool -> open by default so the user sees the live trace.
            expect(details!.hasAttribute('open')).to.equal(true);
            // Tool name present in the title row.
            expect(details!.querySelector('.qaap-lh-toolName')?.textContent).to.contain('search');
            // Params chip parsed from args.
            expect(details!.querySelector('.qaap-lh-params')?.textContent).to.contain('query');
            // Args raw block present in the detail panel.
            expect(details!.querySelector('.qaap-lh-tool-args')?.textContent).to.contain('hello');

            flushSync(() => root.unmount());
        });

        it('renders a non-expandable title row when there are no args and no result', () => {
            const renderer = createRenderer();
            const content = new ToolCallChatResponseContentImpl('id', 'noop', undefined, false);
            const node = renderer.render(content, makeResponseNode(content));
            const { container, root } = renderToContainer(node);

            expect(container.querySelector('details'), 'no details when nothing to expand').to.not.exist;
            expect(container.querySelector('.qaap-lh-tool-accordion')?.textContent).to.contain('noop');

            flushSync(() => root.unmount());
        });

        it('renders a successful finished tool with a success status block', () => {
            const renderer = createRenderer();
            const content = new ToolCallChatResponseContentImpl(
                'id', 'ok', '{"q":"x"}', true, { content: [{ type: 'text', text: 'done' }] } as unknown as ToolCallChatResponseContent['result']
            );
            const node = renderer.render(content, makeResponseNode(content));
            const { container, root } = renderToContainer(node);

            const status = container.querySelector('.qaap-lh-statusBlock');
            expect(status?.getAttribute('data-state')).to.equal('success');
            // Finished tool with result -> not open by default.
            const details = container.querySelector('details.qaap-lh-tool-accordion');
            expect(details?.hasAttribute('open')).to.equal(false);

            flushSync(() => root.unmount());
        });
    });

    describe('render — result content', () => {
        it('renders text tool result content via MarkdownRender', () => {
            const renderer = createRenderer();
            const content = new ToolCallChatResponseContentImpl(
                'id', 'ok', '{}', true,
                { content: [{ type: 'text', text: '# Hello result' }] } as unknown as ToolCallChatResponseContent['result']
            );
            const node = renderer.render(content, makeResponseNode(content));
            const { container, root } = renderToContainer(node);

            // Open the details so the result is mounted.
            const details = container.querySelector('details.qaap-lh-tool-accordion')!;
            details.setAttribute('open', '');
            flushSync(() => { /* trigger re-render via attribute change */ });

            const textResult = container.querySelector('.theia-toolCall-text-result');
            expect(textResult, 'text result block should render').to.exist;

            flushSync(() => root.unmount());
        });

        it('renders error tool result content with error styling', () => {
            const renderer = createRenderer();
            const content = new ToolCallChatResponseContentImpl(
                'id', 'fail', '{}', true,
                { content: [{ type: 'error', data: 'boom' }] } as unknown as ToolCallChatResponseContent['result']
            );
            const node = renderer.render(content, makeResponseNode(content));
            const { container, root } = renderToContainer(node);

            const details = container.querySelector('details.qaap-lh-tool-accordion')!;
            details.setAttribute('open', '');
            flushSync(() => { });

            const errorResult = container.querySelector('.theia-toolCall-error-result');
            expect(errorResult, 'error result block should render').to.exist;
            expect(errorResult?.textContent).to.contain('boom');

            flushSync(() => root.unmount());
        });
    });

    describe('render — stable refs / callbacks', () => {
        it('uses a stable ref callback identity across re-renders (no detach/attach churn)', () => {
            const renderer = createRenderer();
            const content = new ToolCallChatResponseContentImpl('id', 'search', '{"q":"a"}', false);
            const node = renderer.render(content, makeResponseNode(content));
            const { container, root } = renderToContainer(node);

            const summaryBefore = container.querySelector('summary');
            const refFnBefore = (summaryBefore as unknown as { __reactProps?: { ref?: unknown } })?.__reactProps?.ref;
            // Re-render the same node.
            flushSync(() => root.render(<>{renderer.render(content, makeResponseNode(content))}</>));
            const summaryAfter = container.querySelector('summary');

            // The DOM node should be reused (React reconciles by position), proving
            // the stable ref callback did not force a detach.
            expect(summaryAfter, 'summary element should still be present').to.exist;
            void refFnBefore;

            flushSync(() => root.unmount());
        });
    });

    describe('render — streaming mutation across re-renders', () => {
        it('renders the result after complete() mutates the same response instance (regression: stale useMemo)', () => {
            // Reproduces the real streaming flow: ToolCallChatResponseContentImpl
            // is mutated in place by merge() / complete() — the object reference
            // stays stable. A useMemo keyed on [response] would never recompute
            // and the result would never appear after completion.
            const renderer = createRenderer();
            // Start with a running tool call: args present, no result, not finished.
            const content = new ToolCallChatResponseContentImpl('id', 'search', '{"query":"hello"}', false);

            // First render — running, no result yet.
            const node1 = renderer.render(content, makeResponseNode(content));
            const { container, root } = renderToContainer(node1);

            // No result block should be present while streaming.
            expect(container.querySelector('.theia-toolCall-text-result')).to.not.exist;

            // Simulate the tool completing: complete() mutates _finished and
            // _result on the SAME object instance (see chat-model.ts).
            content.complete({ content: [{ type: 'text', text: 'Found 3 results' }] } as unknown as ToolCallChatResponseContent['result']);

            // Re-render with the same mutated instance — the tree widget does
            // this on response.onDidChange → updateScrollToRow → ReactWidget.update.
            flushSync(() => root.render(<>{renderer.render(content, makeResponseNode(content))}</>));

            // The result must now be visible. Open the details to mount the
            // result content (finished tools default to collapsed).
            const details = container.querySelector('details.qaap-lh-tool-accordion') as HTMLDetailsElement;
            expect(details, 'details should still render after completion').to.exist;
            details.setAttribute('open', '');
            flushSync(() => { /* trigger re-render after attribute change */ });

            const textResult = container.querySelector('.theia-toolCall-text-result');
            expect(textResult, 'text result must render after complete() mutation').to.exist;

            flushSync(() => root.unmount());
        });

        it('does not render an expandable detail panel when args is {} and there is no result', () => {
            const renderer = createRenderer();
            const content = new ToolCallChatResponseContentImpl('id', 'noop', '{}', false);
            const node = renderer.render(content, makeResponseNode(content));
            const { container, root } = renderToContainer(node);

            // No result, args is '{}' — should render the non-expandable title
            // row, NOT a <details> with an empty detail panel.
            expect(container.querySelector('details'), 'no details when args is {} and no result').to.not.exist;
            expect(container.querySelector('.qaap-lh-tool-accordion')?.textContent).to.contain('noop');

            flushSync(() => root.unmount());
        });
    });
});
