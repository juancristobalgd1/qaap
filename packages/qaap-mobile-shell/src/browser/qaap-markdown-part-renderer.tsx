// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    ChatResponseContent,
    InformationalChatResponseContent,
    MarkdownChatResponseContent,
} from '@theia/ai-chat/lib/common';
import { ChatResponsePartRenderer } from '@theia/ai-chat-ui/lib/browser/chat-response-part-renderer';
import { OpenerService, open } from '@theia/core/lib/browser';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MarkdownString } from '@theia/core/lib/common/markdown-rendering';
import { URI } from '@theia/core/lib/common/uri';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ReactNode, useEffect, useRef } from '@theia/core/shared/react';
import * as React from '@theia/core/shared/react';
import { MiniBrowserCommands } from '@theia/mini-browser/lib/browser/mini-browser-open-handler';
import {
    QAAP_CHAT_MARKDOWN_PLAIN_STREAM_CLASS,
    type QaapChatMarkdownRenderMode,
    resolveChatMarkdownRenderMode,
} from '../common/qaap-chat-markdown-render';
import {
    applySyncChatMarkdownHost,
    scheduleChatMarkdownWorkerRender,
} from '../common/qaap-chat-markdown-worker-bridge';

export { QAAP_CHAT_MARKDOWN_PLAIN_STREAM_CLASS };

export interface QaapMarkdownRenderProps {
    text: string | MarkdownString;
    openerService: OpenerService;
    commandRegistry: CommandRegistry;
    className?: string;
}

const QaapMarkdownRender: React.FC<QaapMarkdownRenderProps> = ({ text, openerService, commandRegistry, className }) => {
    const ref = useQaapMarkdownRendering(text, openerService, commandRegistry);
    return <div className={className} ref={ref}></div>;
};

export function shouldOpenMarkdownHrefInWorkHubBrowser(href: string, ownerDocument: Document = document): boolean {
    const trimmed = href.trim();
    if (!/^(https?:\/\/|localhost(?::|\/|$)|127\.0\.0\.1(?::|\/|$)|0\.0\.0\.0(?::|\/|$))/i.test(trimmed)) {
        return false;
    }
    const body = ownerDocument.body;
    return !!body?.classList.contains('theia-mobile-mod-workhub-composer-header')
        || !!body?.classList.contains('theia-mobile-mod-workhub-no-bottom-chrome');
}

export async function openQaapMarkdownHref(
    href: string,
    openerService: OpenerService,
    commandRegistry: CommandRegistry,
    ownerDocument: Document = document,
): Promise<void> {
    if (shouldOpenMarkdownHrefInWorkHubBrowser(href, ownerDocument)) {
        try {
            await commandRegistry.executeCommand(MiniBrowserCommands.OPEN_URL.id, href);
            return;
        } catch (error) {
            console.warn('Failed to open WorkHub markdown URL in mini-browser, falling back to opener service.', error);
        }
    }
    await open(openerService, new URI(href));
}

/** Chat markdown renderer — worker offload, RAF-coalesced paints, plain streaming when safe. */
@injectable()
export class QaapMarkdownPartRenderer implements ChatResponsePartRenderer<MarkdownChatResponseContent | InformationalChatResponseContent> {

    static readonly PRIORITY = 11;

    @inject(OpenerService) protected readonly openerService: OpenerService;

    @inject(CommandRegistry) protected readonly commandRegistry: CommandRegistry;

    canHandle(response: ChatResponseContent): number {
        if (MarkdownChatResponseContent.is(response)) {
            return QaapMarkdownPartRenderer.PRIORITY;
        }
        if (InformationalChatResponseContent.is(response)) {
            return QaapMarkdownPartRenderer.PRIORITY;
        }
        return -1;
    }

    render(response: MarkdownChatResponseContent | InformationalChatResponseContent): ReactNode {
        if (InformationalChatResponseContent.is(response)) {
            // eslint-disable-next-line no-null/no-null
            return null;
        }
        return <QaapMarkdownRender text={response.content} openerService={this.openerService} commandRegistry={this.commandRegistry} />;
    }
}

export const useQaapMarkdownRendering = (
    markdown: string | MarkdownString,
    openerService: OpenerService,
    commandRegistry: CommandRegistry,
    skipSurroundingParagraph = false,
): React.RefObject<HTMLDivElement> => {
    // eslint-disable-next-line no-null/no-null
    const ref = useRef<HTMLDivElement | null>(null);
    const lastMarkdownRef = useRef('');
    const lastModeRef = useRef<QaapChatMarkdownRenderMode | undefined>(undefined);
    const rafRef = useRef(0);
    const markdownString = typeof markdown === 'string' ? markdown : markdown.value;

    useEffect(() => {
        if (markdownString === lastMarkdownRef.current) {
            return undefined;
        }

        const applyRender = (): void => {
            rafRef.current = 0;
            const host = ref.current;
            if (!host) {
                return;
            }
            const previousMarkdown = lastMarkdownRef.current;
            const mode = resolveChatMarkdownRenderMode(
                markdownString,
                previousMarkdown,
                lastModeRef.current,
            );
            if (mode === 'plain') {
                host.classList.add(QAAP_CHAT_MARKDOWN_PLAIN_STREAM_CLASS);
                host.classList.remove('theia-mod-markdown');
                host.replaceChildren();
                host.textContent = markdownString;
                delete host.dataset.qaapStreamStableLength;
                delete host.dataset.qaapStreamTotalLength;
                lastMarkdownRef.current = markdownString;
                lastModeRef.current = 'plain';
                return;
            }

            if (mode === 'worker') {
                scheduleChatMarkdownWorkerRender(
                    host,
                    markdownString,
                    previousMarkdown,
                    lastModeRef.current,
                    skipSurroundingParagraph,
                );
                lastMarkdownRef.current = markdownString;
                lastModeRef.current = 'worker';
                return;
            }

            applySyncChatMarkdownHost(host, markdownString, skipSurroundingParagraph);
            lastMarkdownRef.current = markdownString;
            lastModeRef.current = 'sync';
        };

        if (!rafRef.current) {
            rafRef.current = requestAnimationFrame(applyRender);
        }

        const handleClick = (event: MouseEvent): void => {
            let target = event.target as HTMLElement;
            while (target && target.tagName !== 'A') {
                target = target.parentElement as HTMLElement;
            }
            if (target?.tagName === 'A') {
                const href = target.getAttribute('href');
                if (href) {
                    event.preventDefault();
                    event.stopPropagation();
                    void openQaapMarkdownHref(href, openerService, commandRegistry, target.ownerDocument);
                }
            }
        };

        ref.current?.addEventListener('click', handleClick);
        return () => {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = 0;
            }
            ref.current?.removeEventListener('click', handleClick);
        };
    }, [markdownString, skipSurroundingParagraph, openerService, commandRegistry]);

    return ref;
};
