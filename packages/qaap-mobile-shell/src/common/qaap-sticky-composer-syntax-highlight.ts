// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface StickyComposerSyntaxHighlightUi {
    refresh(): void;
    dispose(): void;
}

const SKILL_TOKEN_PATTERN = /\/[a-z0-9]+(?:-[a-z0-9]+)*/g;

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderHighlightedDraft(
    text: string,
    skillNames: ReadonlySet<string>,
    slashCommandNames: ReadonlySet<string>,
): string {
    if (!text) {
        return '';
    }
    let html = '';
    let lastIndex = 0;
    for (const match of text.matchAll(SKILL_TOKEN_PATTERN)) {
        const token = match[0];
        const start = match.index ?? 0;
        if (start > lastIndex) {
            html += escapeHtml(text.slice(lastIndex, start));
        }
        const skillName = token.slice(1).toLowerCase();
        // Skills win over slash-menu labels: skill spans must stay text-only (no chip class).
        if (skillNames.has(skillName)) {
            html += `<span class="theia-mod-token-skill">${escapeHtml(token)}</span>`;
        } else if (slashCommandNames.has(skillName)) {
            html += `<span class="theia-mod-token-slash-command">${escapeHtml(token)}</span>`;
        } else {
            html += escapeHtml(token);
        }
        lastIndex = start + token.length;
    }
    if (lastIndex < text.length) {
        html += escapeHtml(text.slice(lastIndex));
    }
    return html;
}

/** Mirror layer that paints `/skill-name` tokens over the sticky composer textarea. */
export function attachStickyComposerSyntaxHighlight(options: {
    inputEditor: HTMLElement;
    input: HTMLTextAreaElement;
    getSkillNames?: () => readonly string[];
    getSlashCommandNames?: () => readonly string[];
}): StickyComposerSyntaxHighlightUi {
    const { inputEditor, input, getSkillNames, getSlashCommandNames } = options;
    inputEditor.classList.add('theia-mod-syntax-highlight-host');

    const highlight = document.createElement('div');
    highlight.className = 'theia-mobile-projects-sticky-composer-input-highlight';
    highlight.setAttribute('aria-hidden', 'true');
    inputEditor.insertBefore(highlight, input);
    input.classList.add('theia-mod-highlight-input');
    // Spellcheck underlines still paint on transparent textarea text and look like red ghosts.
    const previousSpellcheck = input.spellcheck;
    input.spellcheck = false;

    const refresh = (): void => {
        const skillNames = new Set(
            (getSkillNames?.() ?? []).map(name => name.trim().toLowerCase()).filter(Boolean),
        );
        const slashCommandNames = new Set(
            (getSlashCommandNames?.() ?? []).map(name => name.trim().toLowerCase()).filter(Boolean),
        );
        highlight.innerHTML = renderHighlightedDraft(input.value, skillNames, slashCommandNames);
        highlight.scrollTop = input.scrollTop;
    };

    const onScroll = (): void => {
        highlight.scrollTop = input.scrollTop;
    };

    input.addEventListener('input', refresh);
    input.addEventListener('scroll', onScroll);
    refresh();

    return {
        refresh,
        dispose: () => {
            input.removeEventListener('input', refresh);
            input.removeEventListener('scroll', onScroll);
            highlight.remove();
            input.classList.remove('theia-mod-highlight-input');
            input.spellcheck = previousSpellcheck;
            inputEditor.classList.remove('theia-mod-syntax-highlight-host');
        },
    };
}
