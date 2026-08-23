// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { bindStickyComposerControlClick } from '../common/qaap-sticky-composer-control-click';

export interface StickyComposerWorkspaceBarView {
    readonly projectName: string;
    readonly branchName: string;
}

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

export function appendStickyComposerContextDivider(container: HTMLElement): void {
    const divider = document.createElement('span');
    divider.className = 'theia-mobile-projects-sticky-composer-context-divider';
    divider.setAttribute('aria-hidden', 'true');
    container.append(divider);
}

export function createStickyComposerWorkspacePill(options: {
    readonly iconClass: string;
    readonly label: string;
    readonly ariaLabel: string;
    readonly onClick: (anchor: HTMLButtonElement) => void;
    readonly mono?: boolean;
    readonly branch?: boolean;
    readonly fieldKind?: StickyComposerWorkspaceFieldKind;
}): HTMLButtonElement {
    return createWorkspacePill(options);
}

export function renderStickyComposerWorkspaceBar(options: {
    readonly view: StickyComposerWorkspaceBarView;
    readonly onOpenProject: (anchor: HTMLButtonElement) => void;
    readonly onOpenBranch: (anchor: HTMLButtonElement) => void;
    readonly includeProject?: boolean;
    readonly includeBranch?: boolean;
}): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'theia-mobile-projects-sticky-composer-workspace-bar theia-mobile-projects-sticky-composer-workspace-context-bar';

    const appendField = (pill: HTMLButtonElement, kind: StickyComposerWorkspaceFieldKind): void => {
        if (bar.childElementCount > 0) {
            appendStickyComposerContextDivider(bar);
        }
        const field = document.createElement('div');
        field.className = `theia-mobile-projects-sticky-composer-context-field theia-mod-${kind}`;
        field.append(pill);
        bar.append(field);
    };

    if (options.includeProject !== false) {
        appendField(createWorkspacePill({
            iconClass: 'codicon-repo',
            label: options.view.projectName,
            ariaLabel: nls.localize('qaap/composerWorkspace/projectAria', 'Project: {0}', options.view.projectName),
            onClick: options.onOpenProject,
            fieldKind: 'project',
        }), 'project');
    }
    if (options.includeBranch !== false) {
        appendField(createWorkspacePill({
            iconClass: 'codicon-git-branch',
            label: options.view.branchName,
            ariaLabel: nls.localize('qaap/composerWorkspace/branchAria', 'Branch: {0}', options.view.branchName),
            onClick: options.onOpenBranch,
            mono: true,
            branch: true,
            fieldKind: 'branch',
        }), 'branch');
    }
    return bar;
}

export function appendStickyComposerWorkspaceContextField(
    bar: HTMLElement,
    pill: HTMLButtonElement,
    kind: StickyComposerWorkspaceFieldKind,
    options?: { readonly divider?: boolean },
): void {
    if (bar.childElementCount > 0 && options?.divider !== false) {
        appendStickyComposerContextDivider(bar);
    }
    const field = document.createElement('div');
    field.className = `theia-mobile-projects-sticky-composer-context-field theia-mod-${kind}`;
    field.append(pill);
    bar.append(field);
}

function createWorkspacePill(options: {
    readonly iconClass: string;
    readonly label: string;
    readonly ariaLabel: string;
    readonly onClick: (anchor: HTMLButtonElement) => void;
    readonly mono?: boolean;
    readonly branch?: boolean;
    readonly fieldKind?: StickyComposerWorkspaceFieldKind;
}): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theia-mobile-projects-sticky-composer-workspace-pill';
    if (options.branch) {
        btn.classList.add('theia-mod-branch');
    }
    if (options.fieldKind) {
        btn.classList.add(`theia-mod-field-${options.fieldKind}`);
    }
    btn.title = options.ariaLabel;
    btn.setAttribute('aria-label', options.ariaLabel);
    btn.setAttribute('aria-haspopup', 'dialog');

    const icon = document.createElement('span');
    icon.className = `theia-mobile-projects-sticky-composer-workspace-pill-icon codicon ${options.iconClass}`;
    icon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'theia-mobile-projects-sticky-composer-workspace-pill-label';
    if (options.mono) {
        label.classList.add('theia-mod-mono');
    }
    label.textContent = options.label;

    const chevron = document.createElement('span');
    chevron.className = 'theia-mobile-projects-sticky-composer-workspace-pill-chevron codicon codicon-chevron-down';
    chevron.setAttribute('aria-hidden', 'true');

    btn.append(icon, label, chevron);
    bindStickyComposerControlClick(btn, ev => {
        ev.stopPropagation();
        options.onClick(btn);
    });
    return btn;
}
