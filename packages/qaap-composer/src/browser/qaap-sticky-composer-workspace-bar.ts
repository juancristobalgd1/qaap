// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

export type StickyComposerWorkspaceFieldKind = 'project' | 'branch' | 'destination';

export type ComposerWorkspaceSheetNavKind = StickyComposerWorkspaceFieldKind;

export function createComposerWorkspaceSheetNavGroup(options: {
    readonly active: ComposerWorkspaceSheetNavKind;
    readonly onSelect: (kind: ComposerWorkspaceSheetNavKind) => void;
    /** Destination segment icon; defaults to the current repository when omitted. */
    readonly destinationIconClass?: string;
}): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'theia-mobile-composer-workspace-sheet-nav';

    const bar = document.createElement('div');
    bar.className = 'theia-qaap-segmented-bar theia-mod-composer-workspace-sheet-nav';
    bar.setAttribute('role', 'group');
    bar.setAttribute(
        'aria-label',
        nls.localize('qaap/composerWorkspace/sheetNavAria', 'Workspace context'),
    );

    const destinationIconClass = options.destinationIconClass ?? 'codicon-repo';

    const segments: ReadonlyArray<{
        readonly id: ComposerWorkspaceSheetNavKind;
        readonly label: string;
        readonly iconClass: string;
    }> = [
        {
            id: 'project',
            label: nls.localize('qaap/composerWorkspace/projectSheetTitle', 'Project'),
            iconClass: 'codicon-repo',
        },
        {
            id: 'branch',
            label: nls.localize('qaap/composerWorkspace/branchSheetTitle', 'Branch'),
            iconClass: 'codicon-git-branch',
        },
        {
            id: 'destination',
            label: nls.localize('qaap/composerWorkspace/destinationSheetTitle', 'Run in'),
            iconClass: destinationIconClass,
        },
    ];

    for (const segment of segments) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-qaap-segmented-option';
        btn.title = segment.label;
        btn.setAttribute('aria-label', segment.label);

        const icon = document.createElement('span');
        icon.className = `codicon ${segment.iconClass}`;
        icon.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.className = 'theia-qaap-segmented-option-label';
        label.textContent = segment.label;

        btn.append(icon, label);
        const selected = segment.id === options.active;
        btn.classList.toggle('theia-mod-selected', selected);
        btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
        btn.setAttribute('aria-selected', selected ? 'true' : 'false');
        btn.addEventListener('click', () => {
            if (segment.id !== options.active) {
                options.onSelect(segment.id);
            }
        });
        bar.append(btn);
    }

    wrap.append(bar);
    return wrap;
}
