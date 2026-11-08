// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { appendAgentBrandIcon } from '@theia/qaap-shared-core/lib/common/qaap-agent-branding';
import {
    QaapAgentEffort,
    type QaapAgentEffortLevel,
    type QaapAgentEffortSupport,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-effort';
import {
    QAAP_AGENT_APPROVAL_POLICIES,
    type QaapAgentApprovalPolicyId,
    type QaapAgentApprovalPolicyOption,
} from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-approval-policy';
import {
    QaapComposerModelPickerModel,
    type QaapPickerState,
} from '../common/qaap-composer-model-picker-model';

export interface QaapComposerModelPickerProps {
    readonly state: QaapPickerState;
    readonly effort: { readonly support?: QaapAgentEffortSupport; readonly current?: QaapAgentEffortLevel };
    readonly approval: {
        readonly current: QaapAgentApprovalPolicyId;
        readonly options?: readonly QaapAgentApprovalPolicyOption[];
    };
    /** Narrow viewport: the number shortcuts are desktop-only. */
    readonly isMobile?: boolean;
    readonly onSelectModel: (agentId: string, modelId: string) => void;
    readonly onSelectEffort: (level: QaapAgentEffortLevel) => void;
    readonly onSelectApproval: (policyId: QaapAgentApprovalPolicyId) => void;
    readonly onToggleFavorite: (key: string) => void;
    readonly onQuery: (query: string) => void;
    readonly onRail: (selection: 'favorites' | string) => void;
    readonly onClose: () => void;
    /** Connection strip above the list when the selected harness needs a sign-in or an API key. */
    readonly connect?: { readonly message: string; readonly actionLabel: string; readonly onAction: () => void };
}

interface PickerHostState {
    props: QaapComposerModelPickerProps;
    /** Footer menu currently open: the access presets or the effort levels. */
    openMenu: FooterMenuKey | undefined;
}

/** Latest props per picker root, so one keydown listener serves every re-render. */
const hostStates = new WeakMap<HTMLElement, PickerHostState>();

const SHORTCUT_LIMIT = 9;

/**
 * Paints the model picker (harness rail, model list, effort column and access footer) into `host`.
 * Re-rendering replaces the content; the search input is rebuilt, so callers keep the query in state.
 */
export function renderQaapComposerModelPicker(host: HTMLElement, props: QaapComposerModelPickerProps): void {
    const previous = hostStates.get(host);
    const openMenu = previous?.openMenu;
    if (!previous) {
        host.addEventListener('keydown', event => handlePickerKeydown(host, event));
    }
    hostStates.set(host, { props, openMenu });

    const root = document.createElement('div');
    root.className = 'qaap-model-picker';
    const body = document.createElement('div');
    body.className = 'qaap-model-picker-body';
    body.append(renderRail(host, props), renderList(host, props));
    root.append(body, renderFooter(host, props));
    host.replaceChildren(root);
    const input = root.querySelector<HTMLInputElement>('.qaap-model-picker-search input');
    if (input && props.state.query) {
        input.value = props.state.query;
    }
}

function renderRail(host: HTMLElement, props: QaapComposerModelPickerProps): HTMLElement {
    const nav = document.createElement('nav');
    nav.className = 'qaap-model-picker-rail';
    nav.setAttribute('aria-label', nls.localize('qaap/composer/picker/rail', 'Harnesses'));
    const favoritesLabel = nls.localize('qaap/composer/picker/favorites', 'Favorites');
    nav.append(railButton({
        title: favoritesLabel,
        selected: props.state.railSelection === 'favorites',
        onClick: () => props.onRail('favorites'),
        icon: 'codicon-star-full',
    }));
    for (const harness of props.state.harnesses) {
        const button = railButton({
            title: harness.label,
            selected: props.state.railSelection === harness.id,
            onClick: () => props.onRail(harness.id),
        });
        const brand = appendAgentBrandIcon(button, harness.id, 'sm');
        if (!brand) {
            button.textContent = harness.label.slice(0, 1);
        }
        nav.append(button);
    }
    return nav;
}

function railButton(options: { title: string; selected: boolean; onClick: () => void; icon?: string }): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'qaap-model-picker-rail-item';
    button.classList.toggle('theia-mod-selected', options.selected);
    button.title = options.title;
    button.setAttribute('aria-label', options.title);
    button.setAttribute('aria-pressed', String(options.selected));
    if (options.icon) {
        const glyph = document.createElement('span');
        glyph.className = `codicon ${options.icon}`;
        glyph.setAttribute('aria-hidden', 'true');
        button.append(glyph);
    }
    button.addEventListener('click', ev => {
        ev.preventDefault();
        options.onClick();
    });
    return button;
}

function renderList(host: HTMLElement, props: QaapComposerModelPickerProps): HTMLElement {
    const section = document.createElement('section');
    section.className = 'qaap-model-picker-list';

    const search = document.createElement('label');
    search.className = 'qaap-model-picker-search';
    const glass = document.createElement('span');
    glass.className = 'codicon codicon-search';
    glass.setAttribute('aria-hidden', 'true');
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = nls.localize('qaap/composer/picker/searchModels', 'Search models…');
    input.setAttribute('aria-label', input.placeholder);
    input.autocomplete = 'off';
    input.addEventListener('input', () => props.onQuery(input.value));
    input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            const first = visibleRows(host).find(row => !row.disabled);
            first?.click();
        } else if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            visibleRows(host)[0]?.focus();
        }
    });
    search.append(glass, input);

    if (props.connect) {
        const strip = document.createElement('div');
        strip.className = 'qaap-model-picker-connect';
        strip.setAttribute('role', 'status');
        const text = document.createElement('span');
        text.textContent = props.connect.message;
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'qaap-model-picker-connect-action';
        action.textContent = props.connect.actionLabel;
        action.addEventListener('click', ev => {
            ev.preventDefault();
            props.connect?.onAction();
        });
        strip.append(text, action);
        section.append(strip);
    }
    const rows = document.createElement('div');
    rows.className = 'qaap-model-picker-rows';
    rows.setAttribute('role', 'listbox');
    const models = QaapComposerModelPickerModel.visibleModels(props.state);
    const favorites = new Set(props.state.favorites);
    const compact = !props.isMobile;
    models.forEach((model, index) => {
        const key = QaapComposerModelPickerModel.favoriteKey(model.agentId, model.modelId);
        const isCurrent = model.agentId === props.state.currentAgentId && model.modelId === props.state.currentModelId;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'qaap-model-picker-row';
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(isCurrent));
        row.dataset.agentId = model.agentId;
        row.dataset.modelId = model.modelId;
        row.disabled = !model.available;
        row.classList.toggle('theia-mod-current', isCurrent);
        row.title = model.available ? model.label : (model.unavailableReason ?? model.label);
        row.addEventListener('click', ev => {
            ev.preventDefault();
            if (!model.available) {
                return;
            }
            props.onSelectModel(model.agentId, model.modelId);
        });
        row.addEventListener('keydown', ev => moveRowFocus(host, ev));
        appendAgentBrandIcon(row, model.agentId, 'sm');
        const label = document.createElement('span');
        label.className = 'qaap-model-picker-row-label';
        label.textContent = model.label;
        row.append(label);
        if (model.paid) {
            const paid = document.createElement('span');
            paid.className = 'qaap-model-picker-row-paid';
            paid.textContent = nls.localize('qaap/composer/picker/paid', 'Paid');
            row.append(paid);
        }
        if (isCurrent) {
            const check = document.createElement('span');
            check.className = 'codicon codicon-check qaap-model-picker-check';
            check.setAttribute('aria-hidden', 'true');
            row.append(check);
        }
        const star = document.createElement('span');
        star.className = 'qaap-model-picker-star';
        star.classList.toggle('theia-mod-favorite', favorites.has(key));
        star.setAttribute('role', 'button');
        star.setAttribute('aria-label', nls.localize('qaap/composer/picker/toggleFavorite', 'Favorite'));
        star.title = nls.localize('qaap/composer/picker/toggleFavorite', 'Favorite');
        star.innerHTML = `<span class="codicon ${favorites.has(key) ? 'codicon-star-full' : 'codicon-star-empty'}" aria-hidden="true"></span>`;
        star.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            props.onToggleFavorite(key);
        });
        row.append(star);
        if (compact && index < SHORTCUT_LIMIT) {
            const shortcut = document.createElement('kbd');
            shortcut.className = 'qaap-model-picker-shortcut';
            shortcut.textContent = `⌘${index + 1}`;
            row.append(shortcut);
        }
        rows.append(row);
    });
    if (models.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'qaap-model-picker-empty';
        empty.textContent = nls.localize('qaap/composer/picker/noModels', 'No models match.');
        rows.append(empty);
    }
    section.append(search, rows);
    return section;
}

type FooterMenuKey = 'access' | 'effort';

interface FooterMenuItem {
    readonly label: string;
    readonly iconClass?: string;
    readonly checked: boolean;
    readonly onSelect: () => void;
}

/**
 * One footer control with its menu: the effort and the access controls share this markup and CSS.
 * The menu opens above the control; `openMenu` in the host state keeps it open across repaints.
 */
function createFooterMenu(
    host: HTMLElement,
    key: FooterMenuKey,
    trigger: { readonly iconClass: string; readonly label: string; readonly title: string },
    items: readonly FooterMenuItem[],
): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = `qaap-model-picker-menu-wrap qaap-model-picker-${key}-wrap`;
    const open = hostStates.get(host)?.openMenu === key;

    const menu = document.createElement('ul');
    menu.className = 'qaap-model-picker-access-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = !open;
    for (const item of items) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'qaap-model-picker-access-option';
        button.setAttribute('role', 'menuitemradio');
        button.setAttribute('aria-checked', String(item.checked));
        button.classList.toggle('theia-mod-current', item.checked);
        if (item.iconClass) {
            const glyph = document.createElement('span');
            glyph.className = `codicon ${item.iconClass}`;
            glyph.setAttribute('aria-hidden', 'true');
            button.append(glyph);
        }
        const text = document.createElement('span');
        text.textContent = item.label;
        button.append(text);
        button.addEventListener('click', ev => {
            ev.preventDefault();
            setOpenMenu(host, undefined);
            item.onSelect();
        });
        li.append(button);
        menu.append(li);
    }

    const control = document.createElement('button');
    control.type = 'button';
    control.className = `qaap-model-picker-access qaap-model-picker-${key}`;
    control.title = trigger.title;
    control.setAttribute('aria-label', trigger.title);
    control.setAttribute('aria-haspopup', 'menu');
    control.setAttribute('aria-expanded', String(open));
    const glyph = document.createElement('span');
    glyph.className = `codicon ${trigger.iconClass}`;
    glyph.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = trigger.label;
    const chevron = document.createElement('span');
    chevron.className = 'codicon codicon-chevron-down';
    chevron.setAttribute('aria-hidden', 'true');
    control.append(glyph, text, chevron);
    control.addEventListener('click', ev => {
        ev.preventDefault();
        setOpenMenu(host, hostStates.get(host)?.openMenu === key ? undefined : key);
    });
    wrap.append(control, menu);
    return wrap;
}

function renderFooter(host: HTMLElement, props: QaapComposerModelPickerProps): HTMLElement {
    const footer = document.createElement('footer');
    footer.className = 'qaap-model-picker-footer';
    const options = props.approval.options ?? QAAP_AGENT_APPROVAL_POLICIES;
    const current = options.find(option => option.id === props.approval.current) ?? options[0];

    const left = document.createElement('div');
    left.className = 'qaap-model-picker-footer-left';
    const effortCurrent = props.effort.current;
    if (props.effort.support && effortCurrent) {
        const levelLabel = QaapAgentEffort.label(effortCurrent);
        left.append(createFooterMenu(host, 'effort', {
            iconClass: 'codicon-zap',
            label: levelLabel,
            title: nls.localize('qaap/composer/picker/effortTitle', 'Effort: {0}', levelLabel),
        }, props.effort.support.levels.map(level => ({
            label: QaapAgentEffort.label(level),
            checked: level === effortCurrent,
            onSelect: () => props.onSelectEffort(level),
        }))));
    }

    const right = document.createElement('div');
    right.className = 'qaap-model-picker-footer-right';
    right.append(createFooterMenu(host, 'access', {
        iconClass: current.toolbarIconClass,
        label: current.label,
        title: nls.localize('qaap/composer/picker/accessTitle', 'Access: {0}', current.label),
    }, options.map(option => ({
        label: option.label,
        iconClass: option.sheetIconClass,
        checked: option.id === props.approval.current,
        onSelect: () => props.onSelectApproval(option.id),
    }))));

    footer.append(left, right);
    if (props.approval.current === 'request-approval') {
        const note = document.createElement('p');
        note.className = 'qaap-model-picker-access-note';
        note.textContent = nls.localize('qaap/composer/picker/singleTurnNote', 'Runs as a single turn, without Goal.');
        footer.append(note);
    }
    return footer;
}

/** Opens one footer menu (closing the other) in place, without repainting the list. */
function setOpenMenu(host: HTMLElement, key: FooterMenuKey | undefined): void {
    const state = hostStates.get(host);
    if (!state) {
        return;
    }
    state.openMenu = key;
    for (const menuKey of ['access', 'effort'] as const) {
        const wrap = host.querySelector<HTMLElement>(`.qaap-model-picker-${menuKey}-wrap`);
        const menu = wrap?.querySelector<HTMLElement>('.qaap-model-picker-access-menu');
        const control = wrap?.querySelector<HTMLElement>(`.qaap-model-picker-${menuKey}`);
        if (menu) {
            menu.hidden = key !== menuKey;
        }
        control?.setAttribute('aria-expanded', String(key === menuKey));
    }
}

function visibleRows(host: HTMLElement): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('.qaap-model-picker-row'));
}

function moveRowFocus(host: HTMLElement, event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
    }
    event.preventDefault();
    const rows = visibleRows(host);
    const index = rows.indexOf(event.currentTarget as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? rows[index + 1] : rows[index - 1];
    if (next) {
        next.focus();
    } else if (event.key === 'ArrowUp') {
        host.querySelector<HTMLInputElement>('.qaap-model-picker-search input')?.focus();
    }
}

/** Escape closes; Cmd/Ctrl+1..9 picks that row; the arrow keys and Enter work inside the list. */
function handlePickerKeydown(host: HTMLElement, event: KeyboardEvent): void {
    const state = hostStates.get(host);
    if (!state) {
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (state.openMenu) {
            setOpenMenu(host, undefined);
            return;
        }
        state.props.onClose();
        return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key) && !state.props.isMobile) {
        const index = Number(event.key) - 1;
        const models = QaapComposerModelPickerModel.visibleModels(state.props.state);
        const model = models[index];
        if (!model) {
            return;
        }
        event.preventDefault();
        if (model.available) {
            state.props.onSelectModel(model.agentId, model.modelId);
        }
    }
}
