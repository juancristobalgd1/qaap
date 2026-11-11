// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

/**
 * Fence languages an agent uses to ask for a native UI block in the transcript. A block whose JSON
 * parses against the catalog below is rendered as components; anything else stays a code block.
 */
export const QAAP_UI_FENCE_LANGUAGES: readonly string[] = ['qaap-ui', 'json-render'];

/** Class of the root element of a rendered `qaap-ui` block. */
export const QAAP_UI_ROOT_CLASS = 'theia-mobile-agent-json-ui';

const MAX_SPEC_CHARS = 200_000;
const MAX_DEPTH = 12;
const MAX_NODES = 500;
const MAX_TEXT_CHARS = 10_000;
const MAX_NAME_CHARS = 40;
const RELATIVE_HREF_BASE = 'https://qaap-ui.invalid';

/** Visual weight of a text, badge or alert. */
export type QaapUiTone = 'default' | 'muted' | 'success' | 'warning' | 'danger';

const TONES: readonly QaapUiTone[] = ['default', 'muted', 'success', 'warning', 'danger'];
const CONTAINER_KINDS: readonly string[] = ['Stack', 'Card'];
const KNOWN_KINDS: readonly string[] = [
    'Stack', 'Card', 'Heading', 'Text', 'Badge', 'Alert', 'KeyValue', 'List',
    'Table', 'Progress', 'Code', 'Link', 'Divider', 'Image',
];

/** A child of a container: a nested component or a plain string rendered as text. */
export type QaapUiChild = QaapUiNode | string;

/** One validated component of a `qaap-ui` spec. Props are already typed and clipped. */
export type QaapUiNode =
    | { readonly kind: 'Stack'; readonly direction: 'row' | 'column'; readonly gap: 'sm' | 'md' | 'lg'; readonly children: readonly QaapUiChild[] }
    | { readonly kind: 'Card'; readonly title?: string; readonly subtitle?: string; readonly children: readonly QaapUiChild[] }
    | { readonly kind: 'Heading'; readonly level: 1 | 2 | 3; readonly text: string }
    | { readonly kind: 'Text'; readonly text: string; readonly tone: QaapUiTone }
    | { readonly kind: 'Badge'; readonly text: string; readonly tone: QaapUiTone }
    | { readonly kind: 'Alert'; readonly tone: QaapUiTone; readonly title?: string; readonly text: string }
    | { readonly kind: 'KeyValue'; readonly items: readonly { readonly label: string; readonly value: string }[] }
    | { readonly kind: 'List'; readonly items: readonly string[]; readonly ordered: boolean }
    | { readonly kind: 'Table'; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }
    | { readonly kind: 'Progress'; readonly value: number; readonly label?: string }
    | { readonly kind: 'Code'; readonly code: string; readonly language?: string }
    | { readonly kind: 'Link'; readonly text: string; readonly href: string }
    | { readonly kind: 'Divider' }
    | { readonly kind: 'Image'; readonly src: string; readonly alt: string }
    | { readonly kind: 'Unsupported'; readonly name: string };

/** Thrown while reading one node's props; the node then renders as an "Unsupported component" note. */
class QaapUiInvalidPropsError extends Error {}

/** Thrown when the whole spec exceeds a limit; the block then falls back to the code block. */
class QaapUiSpecLimitError extends Error {}

interface QaapUiParseBudget {
    nodes: number;
}

interface QaapUiBuildContext {
    readonly depth: number;
    readonly budget: QaapUiParseBudget;
}

type QaapUiProps = Readonly<Record<string, unknown>>;

/** Whether a fence info string names a `qaap-ui` block (case-insensitive). */
export function isQaapUiFenceLanguage(language: string | undefined): boolean {
    return language !== undefined && QAAP_UI_FENCE_LANGUAGES.includes(language.toLowerCase());
}

/**
 * Whether an `href` may be rendered as a link: `https://`, `http://localhost`, or a relative
 * reference that stays on the app origin. Any other scheme (`javascript:`, `data:`, `mailto:`)
 * and protocol-relative `//host` references are rejected.
 */
export function isAllowedQaapUiHref(href: string): boolean {
    if (!href || /[\s\\\u0000-\u001f\u007f]/.test(href)) {
        return false;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        try {
            const url = new URL(href);
            return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
        } catch {
            return false;
        }
    }
    try {
        return new URL(href, RELATIVE_HREF_BASE).origin === new URL(RELATIVE_HREF_BASE).origin;
    } catch {
        return false;
    }
}

function isHttpsUrl(value: string): boolean {
    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && Boolean(value) && !Array.isArray(value);
}

function invalid(key: string): never {
    throw new QaapUiInvalidPropsError(key);
}

function clipText(value: string): string {
    return value.length > MAX_TEXT_CHARS ? value.slice(0, MAX_TEXT_CHARS) : value;
}

function spend(budget: QaapUiParseBudget): void {
    budget.nodes += 1;
    if (budget.nodes > MAX_NODES) {
        throw new QaapUiSpecLimitError('nodes');
    }
}

function readText(props: QaapUiProps, key: string, required: boolean): string | undefined {
    const value = props[key];
    if (value === undefined) {
        if (required) {
            invalid(key);
        }
        return undefined;
    }
    if (typeof value !== 'string') {
        return invalid(key);
    }
    return clipText(value);
}

function readRequiredText(props: QaapUiProps, key: string): string {
    return readText(props, key, true) as string;
}

function readEnum<T extends string>(props: QaapUiProps, key: string, allowed: readonly T[], fallback: T): T {
    const value = props[key];
    if (value === undefined) {
        return fallback;
    }
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
        return value as T;
    }
    return invalid(key);
}

function readTone(props: QaapUiProps): QaapUiTone {
    return readEnum(props, 'tone', TONES, 'default');
}

function readStringList(props: QaapUiProps, key: string, budget: QaapUiParseBudget): string[] {
    const value = props[key];
    if (!Array.isArray(value)) {
        return invalid(key);
    }
    return value.map(item => {
        spend(budget);
        if (typeof item !== 'string') {
            return invalid(key);
        }
        return clipText(item);
    });
}

function readProps(record: Record<string, unknown>): QaapUiProps {
    const value = record.props;
    if (value === undefined) {
        return {};
    }
    if (!isRecord(value)) {
        return invalid('props');
    }
    return value;
}

function readChildren(record: Record<string, unknown>, context: QaapUiBuildContext): QaapUiChild[] {
    const value = record.children;
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        return invalid('children');
    }
    return value.map(child => parseChild(child, context.depth + 1, context.budget));
}

function assertNoChildren(record: Record<string, unknown>): void {
    if (record.children !== undefined) {
        invalid('children');
    }
}

function buildNode(kind: string, record: Record<string, unknown>, context: QaapUiBuildContext): QaapUiNode {
    const props = readProps(record);
    if (!CONTAINER_KINDS.includes(kind)) {
        assertNoChildren(record);
    }
    switch (kind) {
        case 'Stack':
            return {
                kind,
                direction: readEnum(props, 'direction', ['row', 'column'] as const, 'column'),
                gap: readEnum(props, 'gap', ['sm', 'md', 'lg'] as const, 'md'),
                children: readChildren(record, context),
            };
        case 'Card':
            return {
                kind,
                title: readText(props, 'title', false),
                subtitle: readText(props, 'subtitle', false),
                children: readChildren(record, context),
            };
        case 'Heading': {
            const level = props.level === undefined ? 2 : props.level;
            if (typeof level !== 'number' || ![1, 2, 3].includes(level)) {
                return invalid('level');
            }
            return { kind, level: level as 1 | 2 | 3, text: readRequiredText(props, 'text') };
        }
        case 'Text':
            return { kind, text: readRequiredText(props, 'text'), tone: readTone(props) };
        case 'Badge':
            return { kind, text: readRequiredText(props, 'text'), tone: readTone(props) };
        case 'Alert':
            return {
                kind,
                tone: readTone(props),
                title: readText(props, 'title', false),
                text: readRequiredText(props, 'text'),
            };
        case 'KeyValue': {
            const value = props.items;
            if (!Array.isArray(value)) {
                return invalid('items');
            }
            const items = value.map(item => {
                spend(context.budget);
                if (!isRecord(item)) {
                    return invalid('items');
                }
                const label = readRequiredText(item, 'label');
                const itemValue = item.value;
                if (typeof itemValue !== 'string' && typeof itemValue !== 'number') {
                    return invalid('items');
                }
                return { label, value: clipText(String(itemValue)) };
            });
            return { kind, items };
        }
        case 'List': {
            const items = readStringList(props, 'items', context.budget);
            const ordered = props.ordered === undefined ? false : props.ordered;
            if (typeof ordered !== 'boolean') {
                return invalid('ordered');
            }
            return { kind, items, ordered };
        }
        case 'Table': {
            const columns = readStringList(props, 'columns', context.budget);
            const value = props.rows;
            if (!Array.isArray(value)) {
                return invalid('rows');
            }
            const rows = value.map(row => {
                if (!Array.isArray(row)) {
                    return invalid('rows');
                }
                return row.map(cell => {
                    spend(context.budget);
                    if (typeof cell === 'string') {
                        return clipText(cell);
                    }
                    if (typeof cell === 'number' && Number.isFinite(cell)) {
                        return String(cell);
                    }
                    return invalid('rows');
                });
            });
            return { kind, columns, rows };
        }
        case 'Progress': {
            const value = props.value;
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
                return invalid('value');
            }
            return { kind, value, label: readText(props, 'label', false) };
        }
        case 'Code':
            return { kind, code: readRequiredText(props, 'code'), language: readText(props, 'language', false) };
        case 'Link': {
            const href = readRequiredText(props, 'href');
            if (!isAllowedQaapUiHref(href)) {
                return invalid('href');
            }
            return { kind, text: readRequiredText(props, 'text'), href };
        }
        case 'Divider':
            return { kind };
        case 'Image': {
            const src = readRequiredText(props, 'src');
            if (!isHttpsUrl(src)) {
                return invalid('src');
            }
            const alt = readRequiredText(props, 'alt');
            if (!alt.trim()) {
                return invalid('alt');
            }
            return { kind, src, alt };
        }
        default:
            return { kind: 'Unsupported', name: kind };
    }
}

function parseChild(value: unknown, depth: number, budget: QaapUiParseBudget): QaapUiChild {
    if (depth > MAX_DEPTH) {
        throw new QaapUiSpecLimitError('depth');
    }
    spend(budget);
    if (typeof value === 'string') {
        return clipText(value);
    }
    if (!isRecord(value) || typeof value.type !== 'string') {
        return { kind: 'Unsupported', name: '' };
    }
    const type: string = value.type;
    const name = type.slice(0, MAX_NAME_CHARS);
    if (!KNOWN_KINDS.includes(type)) {
        return { kind: 'Unsupported', name };
    }
    try {
        return buildNode(type, value, { depth, budget });
    } catch (error) {
        if (error instanceof QaapUiInvalidPropsError) {
            return { kind: 'Unsupported', name };
        }
        throw error;
    }
}

/**
 * Parses and validates a `qaap-ui` spec: `{ "type", "props", "children" }` or `{ "root": node }`.
 * Returns `undefined` when the text is not JSON, the root is not a known component, or a
 * structural limit is exceeded (depth 12, 500 nodes, 200k characters). A node with unknown type or
 * invalid props is kept as an `Unsupported` node so the rest of the UI still renders. Strings longer
 * than 10k characters are truncated.
 */
export function parseQaapUiSpec(text: string): QaapUiNode | undefined {
    if (typeof text !== 'string' || text.length > MAX_SPEC_CHARS) {
        return undefined;
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (!isRecord(raw)) {
        return undefined;
    }
    const rootValue = raw.type === undefined && isRecord(raw.root) ? raw.root : raw;
    if (typeof rootValue.type !== 'string' || !KNOWN_KINDS.includes(rootValue.type)) {
        return undefined;
    }
    try {
        const root = parseChild(rootValue, 1, { nodes: 0 });
        return typeof root === 'string' || root.kind === 'Unsupported' ? undefined : root;
    } catch (error) {
        if (error instanceof QaapUiSpecLimitError) {
            return undefined;
        }
        throw error;
    }
}

export interface QaapUiRenderOptions {
    /** Opens a rendered link; without it, links keep their `href` and the transcript click handler opens them. */
    readonly openLink?: (href: string) => void;
}

function element(doc: Document, tag: string, className: string, text?: string): HTMLElement {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function renderChild(child: QaapUiChild, doc: Document, options: QaapUiRenderOptions): Node {
    if (typeof child === 'string') {
        return element(doc, 'p', `${QAAP_UI_ROOT_CLASS}-text ${QAAP_UI_ROOT_CLASS}-tone-default`, child);
    }
    return renderNode(child, doc, options);
}

function renderNode(node: QaapUiNode, doc: Document, options: QaapUiRenderOptions): HTMLElement {
    const base = QAAP_UI_ROOT_CLASS;
    switch (node.kind) {
        case 'Stack': {
            const stack = element(doc, 'div', `${base}-stack ${base}-stack-${node.direction} ${base}-gap-${node.gap}`);
            stack.append(...node.children.map(child => renderChild(child, doc, options)));
            return stack;
        }
        case 'Card': {
            const card = element(doc, 'section', `${base}-card`);
            if (node.title !== undefined || node.subtitle !== undefined) {
                const head = element(doc, 'header', `${base}-card-head`);
                if (node.title !== undefined) {
                    head.append(element(doc, 'div', `${base}-card-title`, node.title));
                }
                if (node.subtitle !== undefined) {
                    head.append(element(doc, 'div', `${base}-card-subtitle`, node.subtitle));
                }
                card.append(head);
            }
            const body = element(doc, 'div', `${base}-card-body`);
            body.append(...node.children.map(child => renderChild(child, doc, options)));
            card.append(body);
            return card;
        }
        case 'Heading':
            return element(doc, `h${node.level}`, `${base}-heading ${base}-heading-${node.level}`, node.text);
        case 'Text':
            return element(doc, 'p', `${base}-text ${base}-tone-${node.tone}`, node.text);
        case 'Badge':
            return element(doc, 'span', `${base}-badge ${base}-tone-${node.tone}`, node.text);
        case 'Alert': {
            const alert = element(doc, 'div', `${base}-alert ${base}-tone-${node.tone}`);
            alert.setAttribute('role', 'note');
            if (node.title !== undefined) {
                alert.append(element(doc, 'div', `${base}-alert-title`, node.title));
            }
            alert.append(element(doc, 'div', `${base}-alert-text`, node.text));
            return alert;
        }
        case 'KeyValue': {
            const list = element(doc, 'dl', `${base}-kv`);
            for (const item of node.items) {
                const row = element(doc, 'div', `${base}-kv-row`);
                row.append(
                    element(doc, 'dt', `${base}-kv-label`, item.label),
                    element(doc, 'dd', `${base}-kv-value`, item.value),
                );
                list.append(row);
            }
            return list;
        }
        case 'List': {
            const list = element(doc, node.ordered ? 'ol' : 'ul', `${base}-list`);
            for (const item of node.items) {
                list.append(element(doc, 'li', `${base}-list-item`, item));
            }
            return list;
        }
        case 'Table': {
            const scroll = element(doc, 'div', `${base}-table-scroll`);
            const table = element(doc, 'table', `${base}-table`);
            const thead = doc.createElement('thead');
            const headRow = doc.createElement('tr');
            for (const column of node.columns) {
                headRow.append(element(doc, 'th', `${base}-table-th`, column));
            }
            thead.append(headRow);
            const tbody = doc.createElement('tbody');
            for (const row of node.rows) {
                const tr = doc.createElement('tr');
                for (const cell of row) {
                    tr.append(element(doc, 'td', `${base}-table-td`, cell));
                }
                tbody.append(tr);
            }
            table.append(thead, tbody);
            scroll.append(table);
            return scroll;
        }
        case 'Progress': {
            const wrap = element(doc, 'div', `${base}-progress`);
            if (node.label !== undefined) {
                wrap.append(element(doc, 'div', `${base}-progress-label`, node.label));
            }
            const bar = doc.createElement('progress');
            bar.className = `${base}-progress-bar`;
            bar.max = 100;
            bar.value = node.value;
            bar.setAttribute('aria-label', node.label ?? String(node.value));
            wrap.append(bar);
            return wrap;
        }
        case 'Code': {
            const wrap = element(doc, 'div', `${base}-code`);
            if (node.language !== undefined) {
                wrap.append(element(doc, 'div', `${base}-code-language`, node.language));
            }
            const pre = doc.createElement('pre');
            pre.className = `${base}-code-pre`;
            pre.append(element(doc, 'code', `${base}-code-text`, node.code));
            wrap.append(pre);
            return wrap;
        }
        case 'Link': {
            const anchor = element(doc, 'a', `${base}-link`, node.text);
            anchor.setAttribute('href', node.href);
            anchor.setAttribute('target', '_blank');
            anchor.setAttribute('rel', 'noopener noreferrer');
            const openLink = options.openLink;
            if (openLink) {
                anchor.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openLink(node.href);
                });
            }
            return anchor;
        }
        case 'Divider':
            return element(doc, 'hr', `${base}-divider`);
        case 'Image': {
            const image = doc.createElement('img');
            image.className = `${base}-image`;
            image.src = node.src;
            image.alt = node.alt;
            image.loading = 'lazy';
            image.referrerPolicy = 'no-referrer';
            return image;
        }
        case 'Unsupported':
            return element(
                doc,
                'div',
                `${base}-unsupported`,
                nls.localize('qaap/mobileProjects/jsonUiUnsupported', 'Unsupported component: {0}', node.name || '?'),
            );
    }
}

/**
 * Renders a validated spec as native transcript UI. Only `createElement`, `textContent` and
 * attribute setters are used, so spec text is never parsed as HTML.
 */
export function renderQaapUi(spec: QaapUiNode, doc: Document, options: QaapUiRenderOptions = {}): HTMLElement {
    const root = element(doc, 'div', QAAP_UI_ROOT_CLASS);
    root.append(renderNode(spec, doc, options));
    return root;
}

/**
 * Builds the native UI for a `qaap-ui` fence body, or `undefined` when the body is not a valid spec
 * (the caller then keeps the code block).
 */
export function buildQaapUiFenceElement(text: string, doc: Document, options?: QaapUiRenderOptions): HTMLElement | undefined {
    const spec = parseQaapUiSpec(text);
    return spec ? renderQaapUi(spec, doc, options) : undefined;
}
