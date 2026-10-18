// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    cancelConversationTaskPlan,
    editConversationTaskPlan,
    getConversation,
    conversationToSummary,
    runConversationTaskPlan,
    runConversationTaskPlanAsSingle,
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    QaapTaskPlan,
    QAAP_TASK_PLAN_MAX_PROMPT_CHARS,
    QAAP_TASK_PLAN_MAX_SUBTASKS,
    QAAP_TASK_PLAN_MAX_TITLE_CHARS,
    type QaapTaskPlanEditRequest,
    type QaapTaskPlanSubtask,
} from '@theia/qaap-shared-core/lib/common/qaap-task-plan';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

/*
 * Editable task plan card (roadmap H3.1, `doc/qaap-task-plan-fanout.md`) for the open transcript of the
 * conversation that owns the plan. It is mounted as a sibling of the scrolling message list inside the
 * real-chat host, so message re-renders never wipe it (or the field the user is typing in).
 */

export const TRANSCRIPT_TASK_PLAN_CARD_CLASS = 'theia-mobile-transcript-task-plan';
const REAL_CHAT_CLASS = 'theia-mobile-agent-transcript-real-chat';
const DEFAULT_EDIT_DEBOUNCE_MS = 600;

/** Backend calls of the card; defaults to the conversation client. Injected by specs. */
export interface TranscriptTaskPlanCardApi {
    edit(conversationId: string, body: QaapTaskPlanEditRequest): Promise<QaapAgentConversationDTO>;
    run(conversationId: string): Promise<QaapAgentConversationDTO>;
    runSingle(conversationId: string): Promise<QaapAgentConversationDTO>;
    cancel(conversationId: string): Promise<QaapAgentConversationDTO>;
}

export interface TranscriptTaskPlanCardDeps {
    /** Opens a subtask's child conversation (same path as a Work Hub row tap). */
    openConversation(conversationId: string): void;
    readonly api?: TranscriptTaskPlanCardApi;
    readonly now?: () => number;
    readonly editDebounceMs?: number;
}

/** What the card reads from the open conversation: a summary or a full conversation DTO. */
export interface TranscriptTaskPlanCardSource {
    readonly id: string;
    readonly taskPlan?: QaapTaskPlan;
}

const DEFAULT_API: TranscriptTaskPlanCardApi = {
    edit: editConversationTaskPlan,
    run: runConversationTaskPlan,
    runSingle: runConversationTaskPlanAsSingle,
    cancel: cancelConversationTaskPlan,
};

interface TaskPlanDraftRow {
    /** Stable DOM key: the subtask id, or a local key for a row not yet saved. */
    readonly key: string;
    id?: string;
    title: string;
    prompt: string;
}

interface TaskPlanCardState {
    conversationId: string;
    deps: TranscriptTaskPlanCardDeps;
    plan: QaapTaskPlan;
    rows: TaskPlanDraftRow[];
    /** Local edits not yet sent. */
    dirty: boolean;
    /** Bumped per local edit, so an edit made while a PATCH is in flight is sent after it. */
    revision: number;
    /** Run / Run as one task / Cancel request in flight: disables the buttons. */
    actionInFlight: boolean;
    /** Edit PATCH in flight (does not disable the buttons; Run waits for it). */
    editPromise?: Promise<boolean>;
    error?: string;
    editTimer?: number;
    countdownTimer?: number;
    nextLocalKey: number;
}

const cardStates = new WeakMap<HTMLElement, TaskPlanCardState>();
const deferredMountHosts = new WeakSet<HTMLElement>();

/**
 * Shows, updates or removes the plan card in `chatHost`. `source === undefined`, no plan, or a `single`
 * plan removes it. Safe to call on every summary tick: it never rebuilds the editable rows while the user
 * is editing them.
 */
export function syncTranscriptTaskPlanCard(
    chatHost: HTMLElement | undefined,
    source: TranscriptTaskPlanCardSource | undefined,
    deps: TranscriptTaskPlanCardDeps,
): void {
    const mountHost = resolveMountHost(chatHost);
    if (!mountHost) {
        return;
    }
    const existing = findCard(mountHost);
    const plan = source?.taskPlan;
    if (!source || !plan || plan.state === 'single') {
        if (existing) {
            disposeCard(existing);
            existing.remove();
        }
        return;
    }
    let card = existing;
    let state = card ? cardStates.get(card) : undefined;
    if (card && state && state.conversationId !== source.id) {
        disposeCard(card);
        card.remove();
        card = undefined;
        state = undefined;
    }
    if (!card || !state) {
        card = mountHost.ownerDocument.createElement('section');
        card.className = TRANSCRIPT_TASK_PLAN_CARD_CLASS;
        card.setAttribute('aria-label', nls.localize('qaap/taskPlan/cardLabel', 'Task plan'));
        state = {
            conversationId: source.id,
            deps,
            plan,
            rows: draftRowsFromPlan(plan),
            dirty: false,
            revision: 0,
            actionInFlight: false,
            nextLocalKey: 0,
        };
        cardStates.set(card, state);
    }
    state.deps = deps;
    // Never move a mounted card: moving it would blur the field the user is typing in.
    if (card.parentElement !== mountHost) {
        mountHost.append(card);
    }
    applyPlan(card, state, plan);
}

/**
 * Structural host for {@link syncOpenTranscriptTaskPlanCard}: satisfied by the Work Hub panel that hosts the
 * transcript (typed structurally so this layer never imports the Work Hub).
 */
export interface TranscriptTaskPlanCardHost {
    readonly transcriptOpenSummary?: QaapAgentConversationSummaryDTO;
    readonly transcriptOpenProject?: MobileProjectEntry;
    readonly conversations?: { readonly threadStore: { getSummary(id: string): QaapAgentConversationSummaryDTO | undefined } };
    findConversationSummaryById?(id: string): QaapAgentConversationSummaryDTO | undefined;
    /** The Work Hub panel's open-thread path (`MobileProjectsPanel.openConversationSummary`). */
    openConversationSummary?(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): Promise<void>;
}

/** Syncs the card of the conversation open in `chatHost` from the live summary (the two mount points call this). */
export function syncOpenTranscriptTaskPlanCard(host: TranscriptTaskPlanCardHost, chatHost: HTMLElement | undefined): void {
    const openId = host.transcriptOpenSummary?.id;
    const source = openId ? host.conversations?.threadStore.getSummary(openId) ?? host.transcriptOpenSummary : undefined;
    const mountHost = resolveMountHost(chatHost);
    if (!mountHost || (!source?.taskPlan && !findCard(mountHost))) {
        return;
    }
    if (!mountHost.querySelector(':scope > .theia-mobile-agent-transcript')) {
        // Opening a transcript binds the live summary before the first render creates the message
        // list, and that render replaces the host's children. Mount right after it instead.
        if (!deferredMountHosts.has(mountHost)) {
            deferredMountHosts.add(mountHost);
            mountHost.ownerDocument.defaultView?.setTimeout(() => {
                deferredMountHosts.delete(mountHost);
                if (mountHost.isConnected && mountHost.querySelector(':scope > .theia-mobile-agent-transcript')) {
                    syncOpenTranscriptTaskPlanCard(host, mountHost);
                }
            }, 0);
        }
        return;
    }
    syncTranscriptTaskPlanCard(mountHost, source, {
        openConversation: conversationId => { void openTaskPlanConversation(host, conversationId); },
    });
}

async function openTaskPlanConversation(host: TranscriptTaskPlanCardHost, conversationId: string): Promise<void> {
    const project = host.transcriptOpenProject;
    if (!project || !host.openConversationSummary) {
        return;
    }
    const summary = host.findConversationSummaryById?.(conversationId)
        ?? host.conversations?.threadStore.getSummary(conversationId)
        ?? conversationToSummary(await getConversation(conversationId));
    await host.openConversationSummary(project, summary);
}

/** Seconds left until the auto-run fires (never negative). */
export function resolveTaskPlanAutoRunSeconds(plan: Pick<QaapTaskPlan, 'autoRun' | 'autoRunAt'>, now: number): number | undefined {
    if (!plan.autoRun || plan.autoRunAt === undefined) {
        return undefined;
    }
    return Math.max(0, Math.ceil((plan.autoRunAt - now) / 1000));
}

export function formatTaskPlanAutoRunCountdown(seconds: number): string {
    return nls.localize('qaap/taskPlan/autoRunCountdown', 'Runs automatically in {0}s', String(seconds));
}

/** PATCH body for the current rows: the full list, ids keep existing rows, blank rows are left out. */
export function buildTaskPlanEditRequest(
    rows: ReadonlyArray<{ readonly id?: string; readonly title: string; readonly prompt: string }>,
    options?: { readonly autoRun?: boolean },
): QaapTaskPlanEditRequest {
    const subtasks = rows
        .map(row => ({ id: row.id, title: row.title.trim(), prompt: row.prompt.trim() }))
        .filter(row => row.title || row.prompt)
        .map(row => ({ ...(row.id ? { id: row.id } : {}), title: row.title, prompt: row.prompt }));
    return { subtasks, ...(options?.autoRun !== undefined ? { autoRun: options.autoRun } : {}) };
}

function findCard(chatHost: HTMLElement): HTMLElement | undefined {
    return chatHost.querySelector<HTMLElement>(`:scope > .${TRANSCRIPT_TASK_PLAN_CARD_CLASS}`) ?? undefined;
}

function disposeCard(card: HTMLElement): void {
    const state = cardStates.get(card);
    if (!state) {
        return;
    }
    const view = card.ownerDocument.defaultView;
    if (state.editTimer !== undefined) {
        view?.clearTimeout(state.editTimer);
        state.editTimer = undefined;
    }
    stopCountdown(card, state);
    cardStates.delete(card);
}

function draftRowsFromPlan(plan: QaapTaskPlan): TaskPlanDraftRow[] {
    return plan.subtasks.map(subtask => ({ key: subtask.id, id: subtask.id, title: subtask.title, prompt: subtask.prompt }));
}

function isEditing(card: HTMLElement): boolean {
    const active = card.ownerDocument.activeElement;
    return !!active && card.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
}

function applyPlan(card: HTMLElement, state: TaskPlanCardState, plan: QaapTaskPlan): void {
    const previousState = state.plan.state;
    state.plan = plan;
    if (plan.state === 'awaiting-approval') {
        const editing = isEditing(card);
        if (!state.dirty && !editing) {
            state.rows = draftRowsFromPlan(plan);
        }
        if (previousState !== 'awaiting-approval' || !editing || !card.querySelector('.theia-mod-awaiting-body')) {
            renderCard(card, state);
        } else {
            syncAwaitingChrome(card, state);
        }
        return;
    }
    // Leaving the editable state drops any unsent drafts: the server owns the plan now.
    state.dirty = false;
    renderCard(card, state);
}

function renderCard(card: HTMLElement, state: TaskPlanCardState): void {
    const doc = card.ownerDocument;
    const plan = state.plan;
    card.dataset.taskPlanState = plan.state;
    stopCountdown(card, state);
    const children: HTMLElement[] = [];
    switch (plan.state) {
        case 'drafting':
            children.push(createStatusLine(doc, 'codicon-sync codicon-modifier-spin',
                nls.localize('qaap/taskPlan/drafting', 'Planning subtasks…')));
            break;
        case 'awaiting-approval':
            children.push(...createAwaitingContent(card, state));
            break;
        case 'running':
        case 'integrating':
            children.push(...createRunningContent(card, state));
            break;
        default:
            children.push(createTerminalLine(doc, plan));
    }
    card.replaceChildren(...children);
    if (plan.state === 'awaiting-approval') {
        syncAwaitingChrome(card, state);
    }
}

function createStatusLine(doc: Document, icon: string, text: string, tone?: string): HTMLElement {
    const line = doc.createElement('div');
    line.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-status${tone ? ` theia-mod-${tone}` : ''}`;
    line.setAttribute('role', 'status');
    const iconEl = doc.createElement('span');
    iconEl.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-status-icon codicon ${icon}`;
    iconEl.setAttribute('aria-hidden', 'true');
    const label = doc.createElement('span');
    label.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-status-label`;
    label.textContent = text;
    line.append(iconEl, label);
    return line;
}

function createTerminalLine(doc: Document, plan: QaapTaskPlan): HTMLElement {
    const progress = QaapTaskPlan.progress(plan);
    switch (plan.state) {
        case 'done':
            return createStatusLine(doc, 'codicon-pass', nls.localize('qaap/taskPlan/done',
                'Plan done · {0}/{1} subtasks', String(progress.done), String(progress.total)), 'ok');
        case 'failed':
            return createStatusLine(doc, 'codicon-warning', plan.error
                ? nls.localize('qaap/taskPlan/failedWithError', 'Plan failed: {0}', plan.error)
                : nls.localize('qaap/taskPlan/failed', 'Plan failed'), 'fail');
        default:
            return createStatusLine(doc, 'codicon-circle-slash', nls.localize('qaap/taskPlan/cancelled', 'Plan cancelled'), 'cancelled');
    }
}

function createHeader(doc: Document, text: string): HTMLElement {
    const header = doc.createElement('div');
    header.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-header`;
    const title = doc.createElement('span');
    title.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-title`;
    title.textContent = text;
    header.append(title);
    return header;
}

function createButton(doc: Document, className: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-button ${className}`;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
}

function createErrorLine(doc: Document): HTMLElement {
    const error = doc.createElement('div');
    error.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-error`;
    error.setAttribute('role', 'alert');
    error.hidden = true;
    return error;
}

// --- awaiting-approval ---------------------------------------------------------------------------

function createAwaitingContent(card: HTMLElement, state: TaskPlanCardState): HTMLElement[] {
    const doc = card.ownerDocument;
    const header = createHeader(doc, nls.localize('qaap/taskPlan/readyTitle', 'Plan ready · {0} subtasks', String(state.rows.length)));
    const body = doc.createElement('div');
    body.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-body theia-mod-awaiting-body`;
    if (state.plan.summary) {
        const summary = doc.createElement('p');
        summary.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-summary`;
        summary.textContent = state.plan.summary;
        body.append(summary);
    }
    const list = doc.createElement('ol');
    list.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-list`;
    for (const row of state.rows) {
        list.append(createEditableRow(card, state, row));
    }
    body.append(list);
    const add = createButton(doc, 'theia-mod-add', nls.localize('qaap/taskPlan/addSubtask', '+ Add subtask'), () => {
        if (state.rows.length >= QAAP_TASK_PLAN_MAX_SUBTASKS) {
            return;
        }
        const row: TaskPlanDraftRow = { key: `local-${state.nextLocalKey++}`, title: '', prompt: '' };
        state.rows.push(row);
        markDirty(card, state, false);
        const element = createEditableRow(card, state, row);
        list.append(element);
        syncAwaitingChrome(card, state);
        element.querySelector<HTMLInputElement>('input')?.focus();
    });
    body.append(add);

    const countdown = doc.createElement('div');
    countdown.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-countdown`;
    const countdownText = doc.createElement('span');
    countdownText.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-countdown-text`;
    const stopAutoRun = createButton(doc, 'theia-mod-link', nls.localize('qaap/taskPlan/dontAutoRun', "Don't auto-run"), () => {
        void sendEdit(card, state, { autoRun: false });
    });
    countdown.append(countdownText, stopAutoRun);

    const actions = doc.createElement('div');
    actions.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-actions`;
    const run = createButton(doc, 'theia-mod-primary', nls.localize('qaap/taskPlan/run', 'Run'), () => {
        void runAction(card, state, 'run');
    });
    const runSingle = createButton(doc, 'theia-mod-secondary', nls.localize('qaap/taskPlan/runSingle', 'Run as one task'), () => {
        void runAction(card, state, 'runSingle');
    });
    const cancel = createButton(doc, 'theia-mod-tertiary', nls.localize('qaap/taskPlan/cancel', 'Cancel'), () => {
        void runAction(card, state, 'cancel');
    });
    actions.append(run, runSingle, cancel);
    // Run is the default action: focus it when the card appears, unless the user is typing elsewhere.
    const view = doc.defaultView;
    view?.setTimeout(() => {
        const active = doc.activeElement;
        if (run.isConnected && (!active || active === doc.body)) {
            run.focus({ preventScroll: true });
        }
    }, 0);
    return [header, body, countdown, createErrorLine(doc), actions];
}

function createEditableRow(card: HTMLElement, state: TaskPlanCardState, row: TaskPlanDraftRow): HTMLElement {
    const doc = card.ownerDocument;
    const item = doc.createElement('li');
    item.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-row theia-mod-editable`;
    item.dataset.subtaskKey = row.key;

    const fields = doc.createElement('div');
    fields.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-fields`;
    const title = doc.createElement('input');
    title.type = 'text';
    title.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-title-input`;
    title.value = row.title;
    title.maxLength = QAAP_TASK_PLAN_MAX_TITLE_CHARS;
    title.placeholder = nls.localize('qaap/taskPlan/titlePlaceholder', 'Subtask title');
    title.setAttribute('aria-label', nls.localize('qaap/taskPlan/titleLabel', 'Subtask title'));
    title.addEventListener('input', () => {
        row.title = title.value;
        markDirty(card, state, true);
    });
    title.addEventListener('blur', () => flushEdit(card, state));

    const prompt = doc.createElement('textarea');
    prompt.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-prompt-input`;
    prompt.value = row.prompt;
    prompt.rows = 2;
    prompt.maxLength = QAAP_TASK_PLAN_MAX_PROMPT_CHARS;
    prompt.placeholder = nls.localize('qaap/taskPlan/promptPlaceholder', 'Instructions for this subtask');
    prompt.setAttribute('aria-label', nls.localize('qaap/taskPlan/promptLabel', 'Subtask instructions'));
    prompt.addEventListener('input', () => {
        row.prompt = prompt.value;
        markDirty(card, state, true);
    });
    prompt.addEventListener('blur', () => flushEdit(card, state));
    fields.append(title, prompt);

    const remove = doc.createElement('button');
    remove.type = 'button';
    remove.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-remove codicon codicon-close`;
    remove.setAttribute('aria-label', nls.localize('qaap/taskPlan/removeSubtask', 'Remove subtask'));
    remove.title = nls.localize('qaap/taskPlan/removeSubtask', 'Remove subtask');
    remove.addEventListener('click', () => {
        if (state.rows.length <= 1) {
            return;
        }
        state.rows = state.rows.filter(entry => entry !== row);
        item.remove();
        markDirty(card, state, false);
        syncAwaitingChrome(card, state);
        flushEdit(card, state);
    });
    item.append(fields, remove);
    return item;
}

/** Non-editable chrome of the awaiting card: header count, button states, countdown, error. */
function syncAwaitingChrome(card: HTMLElement, state: TaskPlanCardState): void {
    const title = card.querySelector(`.${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-title`);
    const titleText = nls.localize('qaap/taskPlan/readyTitle', 'Plan ready · {0} subtasks', String(state.rows.length));
    if (title && title.textContent !== titleText) {
        title.textContent = titleText;
    }
    card.querySelectorAll<HTMLButtonElement>(`.${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-actions button, .${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-countdown button`)
        .forEach(button => { button.disabled = state.actionInFlight; });
    const add = card.querySelector<HTMLButtonElement>(`.${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-button.theia-mod-add`);
    if (add) {
        add.disabled = state.rows.length >= QAAP_TASK_PLAN_MAX_SUBTASKS;
    }
    card.querySelectorAll<HTMLButtonElement>(`.${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-remove`)
        .forEach(button => { button.disabled = state.rows.length <= 1; });
    syncErrorLine(card, state);
    syncCountdown(card, state);
}

function syncErrorLine(card: HTMLElement, state: TaskPlanCardState): void {
    const error = card.querySelector<HTMLElement>(`.${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-error`);
    if (!error) {
        return;
    }
    error.hidden = !state.error;
    error.textContent = state.error ?? '';
}

function syncCountdown(card: HTMLElement, state: TaskPlanCardState): void {
    const host = card.querySelector<HTMLElement>(`.${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-countdown`);
    const text = host?.querySelector<HTMLElement>(`.${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-countdown-text`);
    if (!host || !text) {
        return;
    }
    const now = state.deps.now ?? Date.now;
    const seconds = state.dirty ? undefined : resolveTaskPlanAutoRunSeconds(state.plan, now());
    host.hidden = seconds === undefined;
    if (seconds === undefined) {
        stopCountdown(card, state);
        return;
    }
    const label = formatTaskPlanAutoRunCountdown(seconds);
    if (text.textContent !== label) {
        text.textContent = label;
    }
    if (state.countdownTimer === undefined) {
        const view = card.ownerDocument.defaultView;
        state.countdownTimer = view?.setInterval(() => {
            if (!card.isConnected || cardStates.get(card) !== state) {
                stopCountdown(card, state);
                return;
            }
            syncCountdown(card, state);
        }, 1000);
    }
}

function stopCountdown(card: HTMLElement, state: TaskPlanCardState): void {
    if (state.countdownTimer !== undefined) {
        card.ownerDocument.defaultView?.clearInterval(state.countdownTimer);
        state.countdownTimer = undefined;
    }
}

function markDirty(card: HTMLElement, state: TaskPlanCardState, debounce: boolean): void {
    state.dirty = true;
    state.revision++;
    // Editing turns auto-run off on the server; stop showing the countdown right away.
    syncCountdown(card, state);
    if (!debounce) {
        return;
    }
    const view = card.ownerDocument.defaultView;
    if (state.editTimer !== undefined) {
        view?.clearTimeout(state.editTimer);
    }
    state.editTimer = view?.setTimeout(() => {
        state.editTimer = undefined;
        flushEdit(card, state);
    }, state.deps.editDebounceMs ?? DEFAULT_EDIT_DEBOUNCE_MS);
}

function flushEdit(card: HTMLElement, state: TaskPlanCardState): void {
    if (state.editTimer !== undefined) {
        card.ownerDocument.defaultView?.clearTimeout(state.editTimer);
        state.editTimer = undefined;
    }
    if (!state.dirty || state.editPromise || state.plan.state !== 'awaiting-approval') {
        return;
    }
    void sendEdit(card, state);
}

/** Sends the rows as one PATCH; an edit made meanwhile is sent right after. Resolves `false` on failure. */
async function sendEdit(card: HTMLElement, state: TaskPlanCardState, options?: { readonly autoRun?: boolean }): Promise<boolean> {
    while (state.editPromise) {
        await state.editPromise;
    }
    const body = buildTaskPlanEditRequest(state.rows, options);
    if (!body.subtasks.length) {
        return true;
    }
    const revision = state.revision;
    const promise = request(card, state, api => api.edit(state.conversationId, body), conv => {
        if (state.revision === revision) {
            state.dirty = false;
        }
        adoptSavedIds(state, conv.taskPlan);
    });
    state.editPromise = promise;
    const ok = await promise;
    state.editPromise = undefined;
    if (ok && state.dirty && state.editTimer === undefined && !state.actionInFlight) {
        flushEdit(card, state);
    }
    return ok;
}

/** Gives rows created locally the ids the server assigned (same order, blank rows excluded). */
function adoptSavedIds(state: TaskPlanCardState, plan: QaapTaskPlan | undefined): void {
    if (!plan) {
        return;
    }
    const saved = plan.subtasks;
    let index = 0;
    for (const row of state.rows) {
        if (!row.title.trim() && !row.prompt.trim()) {
            continue;
        }
        const subtask = saved[index++];
        if (subtask && !row.id) {
            row.id = subtask.id;
        }
    }
}

async function runAction(card: HTMLElement, state: TaskPlanCardState, action: 'run' | 'runSingle' | 'cancel'): Promise<void> {
    if (state.actionInFlight) {
        return;
    }
    state.actionInFlight = true;
    syncBusyChrome(card, state);
    try {
        // Run what the user sees: a pending or in-flight edit (e.g. the blur of the field being
        // typed in when Run was tapped) lands first.
        if (action === 'run' && state.plan.state === 'awaiting-approval') {
            if (state.editTimer !== undefined) {
                card.ownerDocument.defaultView?.clearTimeout(state.editTimer);
                state.editTimer = undefined;
            }
            if (state.editPromise || state.dirty) {
                if (!await sendEdit(card, state)) {
                    return;
                }
            }
        }
        await request(card, state, api => api[action](state.conversationId));
    } finally {
        state.actionInFlight = false;
        if (cardStates.get(card) === state) {
            syncBusyChrome(card, state);
        }
    }
}

async function request(
    card: HTMLElement,
    state: TaskPlanCardState,
    call: (api: TranscriptTaskPlanCardApi) => Promise<QaapAgentConversationDTO>,
    onResult?: (conv: QaapAgentConversationDTO) => void,
): Promise<boolean> {
    state.error = undefined;
    syncBusyChrome(card, state);
    try {
        const conv = await call(state.deps.api ?? DEFAULT_API);
        onResult?.(conv);
        if (cardStates.get(card) === state && conv.taskPlan) {
            if (conv.taskPlan.state === 'single') {
                disposeCard(card);
                card.remove();
            } else {
                applyPlan(card, state, conv.taskPlan);
            }
        }
        return true;
    } catch (error) {
        state.error = error instanceof Error && error.message ? error.message : String(error);
        if (cardStates.get(card) === state) {
            syncBusyChrome(card, state);
        }
        return false;
    }
}

function syncBusyChrome(card: HTMLElement, state: TaskPlanCardState): void {
    if (state.plan.state === 'awaiting-approval') {
        syncAwaitingChrome(card, state);
        return;
    }
    card.querySelectorAll<HTMLButtonElement>(`.${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-actions button`)
        .forEach(button => { button.disabled = state.actionInFlight; });
    syncErrorLine(card, state);
}

// --- running / integrating -----------------------------------------------------------------------

function createRunningContent(card: HTMLElement, state: TaskPlanCardState): HTMLElement[] {
    const doc = card.ownerDocument;
    const plan = state.plan;
    const progress = QaapTaskPlan.progress(plan);
    const header = createHeader(doc, plan.state === 'integrating'
        ? nls.localize('qaap/taskPlan/integrating', 'Integrating results…')
        : nls.localize('qaap/taskPlan/subtasksProgress', 'Subtasks {0}/{1}', String(progress.done), String(progress.total)));
    const body = doc.createElement('div');
    body.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-body`;
    const list = doc.createElement('ol');
    list.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-list`;
    for (const subtask of plan.subtasks) {
        list.append(createRunningRow(doc, state, subtask));
    }
    body.append(list);
    const actions = doc.createElement('div');
    actions.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-actions`;
    actions.append(createButton(doc, 'theia-mod-tertiary', nls.localize('qaap/taskPlan/cancel', 'Cancel'), () => {
        void runAction(card, state, 'cancel');
    }));
    const error = createErrorLine(doc);
    error.hidden = !state.error;
    error.textContent = state.error ?? '';
    return [header, body, error, actions];
}

function createRunningRow(doc: Document, state: TaskPlanCardState, subtask: QaapTaskPlanSubtask): HTMLElement {
    const item = doc.createElement('li');
    item.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-row`;
    item.dataset.subtaskKey = subtask.id;
    const conversationId = subtask.conversationId;
    const content = doc.createElement(conversationId ? 'button' : 'div');
    content.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-row-main`;
    if (content instanceof HTMLButtonElement && conversationId) {
        content.type = 'button';
        content.title = nls.localize('qaap/taskPlan/openSubtask', 'Open this subtask');
        content.addEventListener('click', () => state.deps.openConversation(conversationId));
    }
    const title = doc.createElement('span');
    title.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-row-title`;
    title.textContent = subtask.title;
    content.append(title);
    if (subtask.conflict) {
        const conflict = doc.createElement('span');
        conflict.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-chip theia-mod-conflict`;
        conflict.textContent = nls.localize('qaap/taskPlan/conflict', 'Conflict');
        content.append(conflict);
    }
    const chip = doc.createElement('span');
    chip.className = `${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-chip theia-mod-${subtask.state}`;
    chip.textContent = subtaskStateLabel(subtask.state);
    if (subtask.error) {
        chip.title = subtask.error;
    }
    content.append(chip);
    item.append(content);
    return item;
}

function subtaskStateLabel(state: QaapTaskPlanSubtask['state']): string {
    switch (state) {
        case 'running':
            return nls.localize('qaap/taskPlan/stateRunning', 'Running');
        case 'done':
            return nls.localize('qaap/taskPlan/stateDone', 'Done');
        case 'failed':
            return nls.localize('qaap/taskPlan/stateFailed', 'Failed');
        case 'cancelled':
            return nls.localize('qaap/taskPlan/stateCancelled', 'Cancelled');
        default:
            return nls.localize('qaap/taskPlan/statePending', 'Pending');
    }
}

/**
 * The real-chat host: the card is a sibling of the scrolling `.theia-mobile-agent-transcript` list there.
 * Any other host is the list itself, whose re-renders would wipe the card, so it is not mounted.
 */
function resolveMountHost(chatHost: HTMLElement | undefined): HTMLElement | undefined {
    if (!chatHost) {
        return undefined;
    }
    if (chatHost.classList.contains(REAL_CHAT_CLASS)) {
        return chatHost;
    }
    return chatHost.closest<HTMLElement>(`.${REAL_CHAT_CLASS}`) ?? undefined;
}
