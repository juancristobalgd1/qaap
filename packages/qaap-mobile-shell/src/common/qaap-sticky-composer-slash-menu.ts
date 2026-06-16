// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { bindStickyComposerControlClick } from './qaap-sticky-composer-control-click';

export const SLASH_MENU_SECTION_VISIBLE_LIMIT = 3;

export type StickyComposerSlashActionId = 'fork' | 'new' | 'add-plugin' | 'remove-plugin';

export type StickyComposerSlashEntryKind = 'skill' | 'action' | 'tool';

export interface StickyComposerSlashEntry {
    readonly id: string;
    readonly kind: StickyComposerSlashEntryKind;
    readonly label: string;
    readonly insertBody?: string;
    readonly actionId?: StickyComposerSlashActionId;
    readonly description?: string;
}

export interface StickyComposerSlashSection {
    readonly id: string;
    readonly title: string;
    readonly entries: readonly StickyComposerSlashEntry[];
}

export function buildStickyComposerSlashSections(input: {
    readonly skills: readonly { readonly name: string; readonly description?: string }[];
    readonly canFork?: boolean;
    readonly canManagePlugins?: boolean;
}): StickyComposerSlashSection[] {
    const sections: StickyComposerSlashSection[] = [];

    const actionEntries: StickyComposerSlashEntry[] = [];
    if (input.canFork !== false) {
        actionEntries.push({
            id: 'action:fork',
            kind: 'action',
            label: 'fork',
            actionId: 'fork',
        });
    }
    actionEntries.push({
        id: 'action:new',
        kind: 'action',
        label: 'new',
        actionId: 'new',
        description: nls.localize(
            'qaap/mobileProjects/slashActionNewDescription',
            'Start a new agent with the current prompt',
        ),
    });
    sections.push({
        id: 'actions',
        title: nls.localize('qaap/mobileProjects/slashMenuActions', 'Actions'),
        entries: actionEntries,
    });

    if (input.skills.length > 0) {
        sections.push({
            id: 'skills',
            title: nls.localize('qaap/mobileProjects/slashMenuSkills', 'Skills'),
            entries: input.skills.map(skill => ({
                id: `skill:${skill.name}`,
                kind: 'skill',
                label: skill.name,
                insertBody: `${skill.name} `,
                description: skill.description,
            })),
        });
    }

    if (input.canManagePlugins !== false) {
        sections.push({
            id: 'tools',
            title: nls.localize('qaap/mobileProjects/slashMenuTools', 'Tools'),
            entries: [
                {
                    id: 'tool:add-plugin',
                    kind: 'tool',
                    label: 'add-plugin',
                    actionId: 'add-plugin',
                },
                {
                    id: 'tool:remove-plugin',
                    kind: 'tool',
                    label: 'remove-plugin',
                    actionId: 'remove-plugin',
                },
            ],
        });
    }

    return sections;
}

export function filterStickyComposerSlashSections(
    sections: readonly StickyComposerSlashSection[],
    query: string,
): StickyComposerSlashSection[] {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return sections.map(section => ({ ...section, entries: [...section.entries] }));
    }
    return sections
        .map(section => ({
            ...section,
            entries: section.entries.filter(entry => {
                const label = entry.label.toLowerCase();
                const description = entry.description?.toLowerCase() ?? '';
                return label.includes(needle) || description.includes(needle);
            }),
        }))
        .filter(section => section.entries.length > 0);
}

function slashEntryIconClass(entry: StickyComposerSlashEntry): string {
    if (entry.kind === 'skill') {
        return 'codicon codicon-book';
    }
    if (entry.actionId === 'fork') {
        return 'codicon codicon-repo-forked';
    }
    if (entry.actionId === 'new') {
        return 'codicon codicon-add';
    }
    if (entry.actionId === 'add-plugin') {
        return 'codicon codicon-plug';
    }
    if (entry.actionId === 'remove-plugin') {
        return 'codicon codicon-trash';
    }
    return 'codicon codicon-tools';
}

export function resolveStickyComposerSlashEntryIcon(entry: StickyComposerSlashEntry): string {
    return slashEntryIconClass(entry);
}

export interface RenderStickyComposerSlashMenuOptions {
    readonly list: HTMLElement;
    readonly sections: readonly StickyComposerSlashSection[];
    readonly expandedSections: Set<string>;
    readonly onToggleSection: (sectionId: string) => void;
    readonly onSelectEntry: (entry: StickyComposerSlashEntry) => void;
    readonly onPickStart: () => void;
}

export function renderStickyComposerSlashMenu(options: RenderStickyComposerSlashMenuOptions): number {
    const {
        list,
        sections,
        expandedSections,
        onToggleSection,
        onSelectEntry,
        onPickStart,
    } = options;
    list.replaceChildren();
    list.className = 'theia-mobile-projects-sticky-composer-slash-list';
    let optionCount = 0;

    for (const section of sections) {
        const sectionEl = document.createElement('section');
        sectionEl.className = 'theia-mobile-projects-sticky-composer-slash-section';
        sectionEl.dataset.sectionId = section.id;

        const heading = document.createElement('div');
        heading.className = 'theia-mobile-projects-sticky-composer-slash-section-title';
        heading.textContent = section.title;
        sectionEl.append(heading);

        const expanded = expandedSections.has(section.id) || section.entries.length <= SLASH_MENU_SECTION_VISIBLE_LIMIT;
        const visibleEntries = expanded
            ? section.entries
            : section.entries.slice(0, SLASH_MENU_SECTION_VISIBLE_LIMIT);
        const hiddenCount = section.entries.length - visibleEntries.length;

        for (const entry of visibleEntries) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'theia-mobile-projects-sticky-composer-slash-option';
            if (entry.description) {
                btn.classList.add('theia-mod-has-description');
            }
            btn.setAttribute('role', 'option');
            btn.dataset.slashEntryId = entry.id;
            btn.dataset.slashEntryKind = entry.kind;

            const icon = document.createElement('span');
            icon.className = `${slashEntryIconClass(entry)} theia-mobile-projects-sticky-composer-slash-option-icon`;
            icon.setAttribute('aria-hidden', 'true');

            const text = document.createElement('span');
            text.className = 'theia-mobile-projects-sticky-composer-slash-option-text';

            const label = document.createElement('span');
            label.className = 'theia-mobile-projects-sticky-composer-slash-option-label';
            label.textContent = entry.label;
            text.append(label);

            if (entry.description) {
                const hint = document.createElement('span');
                hint.className = 'theia-mobile-projects-sticky-composer-slash-option-hint';
                hint.textContent = entry.description;
                text.append(hint);
            }

            btn.append(icon, text);
            bindStickyComposerControlClick(btn, ev => {
                ev.preventDefault();
                ev.stopPropagation();
                onSelectEntry(entry);
            }, {
                onPressStart: () => {
                    onPickStart();
                },
            });
            sectionEl.append(btn);
            optionCount++;
        }

        if (hiddenCount > 0) {
            const moreBtn = document.createElement('button');
            moreBtn.type = 'button';
            moreBtn.className = 'theia-mobile-projects-sticky-composer-slash-show-more';
            moreBtn.textContent = nls.localize(
                'qaap/mobileProjects/slashMenuShowMore',
                'Show {0} more',
                String(hiddenCount),
            );
            bindStickyComposerControlClick(moreBtn, ev => {
                ev.preventDefault();
                ev.stopPropagation();
                onToggleSection(section.id);
            });
            sectionEl.append(moreBtn);
        }

        list.append(sectionEl);
    }

    return optionCount;
}

export function removeActiveSlashToken(
    value: string,
    caret: number,
): { readonly value: string; readonly caret: number } {
    let wordStart = Math.max(0, Math.min(caret, value.length));
    while (wordStart > 0 && /[\w-]/.test(value.charAt(wordStart - 1))) {
        wordStart--;
    }
    const triggerIndex = wordStart - 1;
    if (triggerIndex < 0 || value.charAt(triggerIndex) !== '/') {
        return { value, caret };
    }
    if (triggerIndex > 0 && !/\s/.test(value.charAt(triggerIndex - 1))) {
        return { value, caret };
    }
    const next = value.slice(0, triggerIndex) + value.slice(caret);
    return { value: next, caret: triggerIndex };
}
