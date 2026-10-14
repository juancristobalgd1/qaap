// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Exact boot replica of the Work Hub. The Work Hub records what it shows (its DOM structure,
 * the theme variables and the stylesheets that style it); on the next load the pre-bundle login
 * gate (`qaap-login-gate.js`) rebuilds that DOM with the same stylesheets, so the screen the
 * real Work Hub mounts over is pixel-identical and the hand-over is invisible.
 *
 * Contract (`localStorage`, key {@link QAAP_WORK_HUB_BOOT_REPLICA_KEY}), read only by the gate:
 * ```
 * { v: 1, savedAt, login, build,          // build: the page's bundle stylesheet reference
 *   stylesheets: string[],                // same-origin relative bundle / chunk .css hrefs
 *   rootStyle: string,                    // `--name: value;` custom properties of <html>
 *   background: string,                   // panel background color (shown while CSS loads)
 *   bodyClasses: string[], shellClasses: string[],
 *   tree: QaapBootReplicaNode }            // the visible Work Hub panel
 * ```
 * The tree holds element names, an allowlist of presentational attributes and text — never
 * markup, event handlers, URLs or form values. The gate rebuilds it with createElement and
 * re-validates every name and attribute. Cleared with the auth session.
 */
export const QAAP_WORK_HUB_BOOT_REPLICA_KEY = 'qaap.workhub.bootReplica.v1';
/** Upper bound for the serialized replica; a bigger Work Hub (long transcript) is not recorded. */
export const QAAP_WORK_HUB_BOOT_REPLICA_MAX_CHARS = 400_000;

/** A text node, or `[tagName, attributes | 0, ...children]`. */
export type QaapBootReplicaNode = string | [string, Record<string, string> | 0, ...QaapBootReplicaNode[]];

export interface QaapWorkHubBootReplica {
    v: 1;
    savedAt: number;
    login: string;
    build: string;
    stylesheets: string[];
    rootStyle: string;
    background: string;
    bodyClasses: string[];
    shellClasses: string[];
    tree: QaapBootReplicaNode;
}

/** Elements never recorded (their subtree is dropped). */
const SKIPPED_TAGS = new Set(['script', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'template', 'video', 'audio', 'canvas', 'noscript', 'base', 'form']);

/** Presentational attributes the replica keeps (plus `aria-*` and `data-*`). */
const KEPT_ATTRIBUTES = new Set([
    'class', 'role', 'title', 'placeholder', 'rows', 'type', 'hidden', 'disabled', 'tabindex', 'dir', 'lang', 'style',
    // SVG geometry and paint
    'viewbox', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
    'stroke-dashoffset', 'stroke-miterlimit', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity',
    'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'transform',
    'preserveaspectratio', 'focusable', 'xmlns',
]);

/** `style` values must not fetch anything when the gate applies them. */
function isSafeStyle(value: string): boolean {
    return !/url\s*\(|expression\s*\(|@import|javascript:/i.test(value);
}

function keepAttribute(name: string, value: string): boolean {
    const lower = name.toLowerCase();
    if (lower.startsWith('on')) {
        return false;
    }
    if (lower === 'style') {
        return isSafeStyle(value);
    }
    return KEPT_ATTRIBUTES.has(lower) || lower.startsWith('aria-') || lower.startsWith('data-');
}

/** Serializes an element subtree into the replica tree format (see {@link QaapBootReplicaNode}). */
export function serializeQaapBootReplicaNode(node: Node): QaapBootReplicaNode | undefined {
    if (node.nodeType === 3) {
        const text = node.nodeValue ?? '';
        return text.length ? text : undefined;
    }
    if (node.nodeType !== 1) {
        return undefined;
    }
    const element = node as Element;
    const tag = element.localName;
    if (SKIPPED_TAGS.has(tag)) {
        return undefined;
    }
    let attributes: Record<string, string> | 0 = 0;
    for (const attribute of Array.from(element.attributes)) {
        if (keepAttribute(attribute.name, attribute.value)) {
            attributes = attributes || {};
            attributes[attribute.name] = attribute.value;
        }
    }
    const result: [string, Record<string, string> | 0, ...QaapBootReplicaNode[]] = [tag, attributes];
    for (const child of Array.from(element.childNodes)) {
        const serialized = serializeQaapBootReplicaNode(child);
        if (serialized !== undefined) {
            result.push(serialized);
        }
    }
    return result;
}

/** Relative path (with query) of a same-origin bundle / chunk stylesheet, else undefined. */
export function toQaapBootReplicaStylesheet(href: string, origin: string): string | undefined {
    let url: URL;
    try {
        url = new URL(href, origin + '/');
    } catch {
        return undefined;
    }
    if (url.origin !== origin) {
        return undefined;
    }
    const file = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
    if (!/^(bundle(-mobile)?|chunk-[A-Z0-9]+)\.css$/.test(file)) {
        return undefined;
    }
    return './' + file + url.search;
}

/** Only the `--custom-property: value;` declarations of an inline style (the theme colors). */
export function customPropertiesOf(style: string): string {
    return style.split(';')
        .map(declaration => declaration.trim())
        .filter(declaration => declaration.startsWith('--') && isSafeStyle(declaration))
        .join(';');
}

/**
 * Body classes the gate may apply early, all re-asserted at startup: theme, Work Hub chrome, and
 * the OS class (it selects the UI font stack; same device, same class).
 */
export function isQaapBootReplicaBodyClass(cssClass: string): boolean {
    return /^qaap-theme-(light|dark)$/.test(cssClass) || /^theia-mobile-mod-workhub-[a-z-]+$/.test(cssClass)
        || /^(linux|windows|mac)$/.test(cssClass);
}

export interface QaapBootReplicaSource {
    readonly panel: Element;
    readonly shell: Element | null;
    readonly login: string;
    readonly build: string;
    readonly origin: string;
    readonly document: Document;
}

/** Builds the replica record; undefined when the result would exceed the size bound. */
export function buildQaapWorkHubBootReplica(source: QaapBootReplicaSource, savedAt: number = Date.now()): QaapWorkHubBootReplica | undefined {
    const tree = serializeQaapBootReplicaNode(source.panel);
    if (!tree || typeof tree === 'string') {
        return undefined;
    }
    const stylesheets: string[] = [];
    for (const link of Array.from(source.document.querySelectorAll('link[rel="stylesheet"]'))) {
        const stylesheet = toQaapBootReplicaStylesheet(link.getAttribute('href') ?? '', source.origin);
        if (stylesheet && !stylesheets.includes(stylesheet)) {
            stylesheets.push(stylesheet);
        }
    }
    const view = source.document.defaultView;
    const panelStyle = view ? view.getComputedStyle(source.panel) : undefined;
    const replica: QaapWorkHubBootReplica = {
        v: 1,
        savedAt,
        login: source.login,
        build: source.build,
        stylesheets,
        rootStyle: customPropertiesOf(source.document.documentElement.getAttribute('style') ?? ''),
        background: panelStyle && isSafeStyle(panelStyle.backgroundColor) ? panelStyle.backgroundColor : '',
        bodyClasses: Array.from(source.document.body.classList).filter(isQaapBootReplicaBodyClass),
        shellClasses: source.shell ? Array.from(source.shell.classList) : [],
        tree,
    };
    return JSON.stringify(replica).length <= QAAP_WORK_HUB_BOOT_REPLICA_MAX_CHARS ? replica : undefined;
}

/** Writes the replica; never throws (quota / privacy mode: the replica is a best-effort hint). */
export function writeQaapWorkHubBootReplica(replica: QaapWorkHubBootReplica): boolean {
    try {
        window.localStorage.setItem(QAAP_WORK_HUB_BOOT_REPLICA_KEY, JSON.stringify(replica));
        return true;
    } catch {
        return false;
    }
}
