// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { AbstractDialog, MarkdownRenderer } from '@theia/core/lib/browser';
import { MarkdownStringImpl } from '@theia/core/lib/common/markdown-rendering/markdown-string';
import { Skill } from '@theia/ai-core/lib/common/skill';
import { MarkdownRenderResult } from '@theia/core/lib/browser/markdown-rendering/markdown-renderer';

/** Read-only, scrollable view of a skill's SKILL.md file. */
export class QaapSkillMarkdownDialog extends AbstractDialog<undefined> {

    protected readonly status: HTMLParagraphElement;
    protected readonly markdownContent: HTMLDivElement;
    protected renderedMarkdown: MarkdownRenderResult | undefined;
    protected closedOrDisposed = false;

    constructor(skill: Skill, protected readonly markdownRenderer: MarkdownRenderer) {
        super({
            title: nls.localize('qaap/aiConfiguration/skillMarkdownTitle', '{0} — SKILL.md', skill.name),
            maxWidth: 920,
        });
        this.addClass('qaap-ai-skill-markdown-dialog');
        this.node.setAttribute('role', 'dialog');
        this.node.setAttribute('aria-modal', 'true');
        this.node.setAttribute('aria-label', nls.localize(
            'qaap/aiConfiguration/skillMarkdownTitle',
            '{0} — SKILL.md',
            skill.name,
        ));

        this.status = document.createElement('p');
        this.status.className = 'qaap-ai-skill-markdown-status';
        this.status.setAttribute('role', 'status');
        this.status.textContent = nls.localize('qaap/aiConfiguration/skillMarkdownLoading', 'Loading skill instructions…');

        this.markdownContent = document.createElement('div');
        this.markdownContent.className = 'qaap-ai-skill-markdown-content';
        this.markdownContent.setAttribute('aria-label', nls.localize(
            'qaap/aiConfiguration/skillMarkdownContent',
            'Skill instructions',
        ));
        this.contentNode.classList.add('qaap-ai-skill-markdown-dialog-body');
        this.contentNode.setAttribute('aria-busy', 'true');
        this.contentNode.append(this.status, this.markdownContent);
        this.appendCloseButton(nls.localizeByDefault('Close'));
    }

    get value(): undefined {
        return undefined;
    }

    setMarkdown(markdown: string): void {
        if (this.closedOrDisposed) {
            return;
        }
        this.renderedMarkdown?.dispose();
        this.renderedMarkdown = this.markdownRenderer.render(new MarkdownStringImpl(markdown));
        this.markdownContent.replaceChildren(this.renderedMarkdown.element);
        this.status.remove();
        this.contentNode.setAttribute('aria-busy', 'false');
    }

    setError(message: string): void {
        if (this.closedOrDisposed) {
            return;
        }
        this.renderedMarkdown?.dispose();
        this.renderedMarkdown = undefined;
        this.markdownContent.replaceChildren();
        this.status.textContent = message;
        this.status.setAttribute('role', 'alert');
        this.contentNode.setAttribute('aria-busy', 'false');
    }

    override dispose(): void {
        this.closedOrDisposed = true;
        this.renderedMarkdown?.dispose();
        super.dispose();
    }
}
