// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface HubEmptyStateOptions {
    /** Codicon class, e.g. `codicon-git-pull-request`. */
    readonly icon: string;
    readonly title: string;
    readonly hint: string;
    readonly action?: { readonly label: string; readonly onClick: () => void };
    /** Extra class so callers keep a layout hook. */
    readonly className?: string;
}

/** Design-system helpers shared by the Tasks, Review and Home hub surfaces (`q-empty` / `q-skeleton`). */
export namespace HubEmptyStateDom {

    /** `q-empty` block: icon, title, hint and an optional primary action. */
    export function createEmptyState(options: HubEmptyStateOptions): HTMLElement {
        const empty = document.createElement('div');
        empty.className = options.className ? `q-empty ${options.className}` : 'q-empty';
        const icon = document.createElement('span');
        icon.className = `q-empty-icon codicon ${options.icon}`;
        icon.setAttribute('aria-hidden', 'true');
        const title = document.createElement('p');
        title.className = 'q-empty-title';
        title.textContent = options.title;
        const hint = document.createElement('p');
        hint.className = 'q-empty-hint';
        hint.textContent = options.hint;
        empty.append(icon, title, hint);
        if (options.action) {
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'q-empty-action';
            action.textContent = options.action.label;
            action.addEventListener('click', options.action.onClick);
            empty.append(action);
        }
        return empty;
    }

    /** List of `q-skeleton` rows that mirrors the task row layout; announced as busy to assistive tech. */
    export function createSkeletonList(label: string, rows = 4): HTMLElement {
        const list = document.createElement('div');
        list.className = 'theia-mobile-tasks-skeleton-list';
        list.setAttribute('aria-busy', 'true');
        list.setAttribute('aria-label', label);
        for (let i = 0; i < rows; i++) {
            const row = document.createElement('div');
            row.className = 'theia-mobile-tasks-skeleton-row q-card';
            const avatar = document.createElement('div');
            avatar.className = 'q-skeleton theia-mobile-tasks-skeleton-avatar';
            const body = document.createElement('div');
            body.className = 'theia-mobile-tasks-skeleton-body';
            const title = document.createElement('div');
            title.className = 'q-skeleton q-skeleton-text theia-mobile-tasks-skeleton-title';
            const meta = document.createElement('div');
            meta.className = 'q-skeleton q-skeleton-text theia-mobile-tasks-skeleton-meta';
            body.append(title, meta);
            row.append(avatar, body);
            list.append(row);
        }
        return list;
    }
}
