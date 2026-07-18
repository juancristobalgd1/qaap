// *****************************************************************************
// Copyright (C) 2026 Theia contributors.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    ELEMENT_PICKER_MESSAGE_TYPE,
    ELEMENT_PICKER_CANCEL_TYPE,
    ELEMENT_PICKER_START_TYPE,
    ELEMENT_UPDATE_STYLE_TYPE,
    ELEMENT_UPDATE_TEXT_TYPE,
    ELEMENT_REFRESH_REQUEST_TYPE,
    ELEMENT_REFRESH_RESPONSE_TYPE,
    ELEMENT_SET_MODE_TYPE,
    ELEMENT_ANNOTATION_POINT_TYPE,
    ELEMENT_ANNOTATION_CANCEL_TYPE,
    ELEMENT_ANNOTATION_REANCHOR_TYPE,
    ELEMENT_ANNOTATION_REANCHOR_RESULT_TYPE,
    PICKED_ATTRIBUTE
} from './element-inspector-types';

const BRIDGE_GLOBAL = '__theiaMiniBrowserBridge__';
const PICKER_GLOBAL = '__theiaMiniBrowserElementPicker__';
const OVERLAY_ID = 'theia-mini-browser-picker-overlay';
const LABEL_ID = 'theia-mini-browser-picker-label';
const STYLE_ID = 'theia-mini-browser-picker-style';
const TOOLBAR_ID = 'theia-mini-browser-picker-toolbar';

export interface ElementBridgeScriptOptions {
    readonly channelId: string;
    readonly parentOrigin: string;
}

/**
 * Resident bridge injected once per loaded page. It tracks picked nodes by id
 * and responds to style / text mutations and refresh requests coming from the parent.
 * Also hosts annotate-mode click capture and marker re-anchoring (Select picker stays separate).
 *
 * Idempotent: re-injecting is a no-op once annotate-ready; an older bridge is upgraded in place.
 */
export function buildElementBridgeScript(options?: ElementBridgeScriptOptions): string {
    return `(() => {
    const existing = window.${BRIDGE_GLOBAL};
    if (existing && existing.annotateReady) return;

    const PICKED_ATTR = ${JSON.stringify(PICKED_ATTRIBUTE)};
    const UPDATE_STYLE = ${JSON.stringify(ELEMENT_UPDATE_STYLE_TYPE)};
    const UPDATE_TEXT = ${JSON.stringify(ELEMENT_UPDATE_TEXT_TYPE)};
    const REFRESH_REQ = ${JSON.stringify(ELEMENT_REFRESH_REQUEST_TYPE)};
    const REFRESH_RES = ${JSON.stringify(ELEMENT_REFRESH_RESPONSE_TYPE)};
    const SET_MODE = ${JSON.stringify(ELEMENT_SET_MODE_TYPE)};
    const START_PICKER = ${JSON.stringify(ELEMENT_PICKER_START_TYPE)};
    const ANNOTATION_POINT = ${JSON.stringify(ELEMENT_ANNOTATION_POINT_TYPE)};
    const ANNOTATION_CANCEL = ${JSON.stringify(ELEMENT_ANNOTATION_CANCEL_TYPE)};
    const REANCHOR = ${JSON.stringify(ELEMENT_ANNOTATION_REANCHOR_TYPE)};
    const REANCHOR_RES = ${JSON.stringify(ELEMENT_ANNOTATION_REANCHOR_RESULT_TYPE)};
    const CHANNEL_ID = ${JSON.stringify(options?.channelId ?? '')};
    const PARENT_ORIGIN = ${JSON.stringify(options?.parentOrigin ?? '')};

    const truncate = (s, max) => s.length > max ? s.slice(0, max - 1) + '\u2026' : s;

    const computeDomPath = (el) => {
        const parts = [];
        let node = el;
        while (node && node.nodeType === 1 && node !== document.documentElement) {
            let part = node.tagName.toLowerCase();
            if (node.id) {
                part += '#' + node.id;
                parts.unshift(part);
                break;
            }
            if (node.classList && node.classList.length) {
                part += '.' + Array.from(node.classList).slice(0, 3).join('.');
            }
            const parent = node.parentElement;
            if (parent) {
                const sameTagSiblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
                if (sameTagSiblings.length > 1) {
                    part += '[' + sameTagSiblings.indexOf(node) + ']';
                }
            }
            parts.unshift(part);
            node = node.parentElement;
        }
        return 'html > ' + parts.join(' > ');
    };

    const buildStableSelector = (el) => {
        const tag = (el.tagName || '').toLowerCase();
        if (el.id) return tag + '#' + el.id;
        const classes = Array.from(el.classList || []).slice(0, 4);
        if (classes.length) return tag + '.' + classes.join('.');
        return computeDomPath(el);
    };

    const documentRatios = (clientX, clientY) => {
        const doc = document.documentElement;
        const body = document.body;
        const scrollX = window.scrollX || doc.scrollLeft || 0;
        const scrollY = window.scrollY || doc.scrollTop || 0;
        const width = Math.max(doc.scrollWidth || 0, body ? body.scrollWidth : 0, 1);
        const height = Math.max(doc.scrollHeight || 0, body ? body.scrollHeight : 0, 1);
        return {
            documentXRatio: Math.min(1, Math.max(0, (scrollX + clientX) / width)),
            documentYRatio: Math.min(1, Math.max(0, (scrollY + clientY) / height)),
            scrollX,
            scrollY,
            width,
            height
        };
    };

    const serialize = (el, pickedId) => {
        const rect = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        const styles = {};
        for (let i = 0; i < cs.length; i++) {
            const name = cs.item(i);
            if (name) styles[name] = cs.getPropertyValue(name).trim();
        }
        const ancestors = [];
        let a = el.parentElement;
        while (a && ancestors.length < 6) {
            ancestors.push({
                tagName: a.tagName.toLowerCase(),
                id: a.id || undefined,
                classes: Array.from(a.classList || [])
            });
            a = a.parentElement;
        }
        return {
            pickedId,
            tagName: el.tagName.toLowerCase(),
            id: el.id || undefined,
            classes: Array.from(el.classList || []),
            attributes: Array.from(el.attributes || []).map(attr => ({ name: attr.name, value: attr.value })),
            textPreview: truncate((el.textContent || '').replace(/\\s+/g, ' ').trim(), 160),
            outerHTML: truncate(el.outerHTML || '', 2000),
            domPath: computeDomPath(el),
            position: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
            computedStyles: styles,
            ancestors,
            pageUrl: location.href
        };
    };

    const nextId = (() => {
        let counter = 0;
        return () => 'tmb-' + Date.now().toString(36) + '-' + (++counter).toString(36);
    })();

    const bridge = existing && existing.nodes ? existing : {
        nodes: new Map(),
        register(el) {
            let id = el.getAttribute(PICKED_ATTR);
            if (!id) {
                id = nextId();
                el.setAttribute(PICKED_ATTR, id);
            }
            this.nodes.set(id, el);
            return id;
        },
        findById(id) {
            const cached = this.nodes.get(id);
            if (cached && cached.isConnected) return cached;
            const fresh = document.querySelector('[' + PICKED_ATTR + '="' + id + '"]');
            if (fresh) this.nodes.set(id, fresh);
            return fresh || undefined;
        },
        applyStyle(id, prop, value, important) {
            const el = this.findById(id);
            if (!el || !el.style) return false;
            try {
                el.style.setProperty(prop, value, important ? 'important' : '');
                return true;
            } catch (e) {
                return false;
            }
        },
        applyText(id, text) {
            const el = this.findById(id);
            if (!el) return false;
            el.textContent = text;
            return true;
        },
        refresh(id) {
            const el = this.findById(id);
            if (!el) return undefined;
            return serialize(el, id);
        },
        serialize
    };

    // Preserve Select helpers on upgrade; attach annotate mode API.
    bridge.serialize = serialize;
    bridge.mode = bridge.mode || 'browse';
    bridge.annotateReady = true;
    bridge.channelId = CHANNEL_ID;
    bridge.parentOrigin = PARENT_ORIGIN;
    bridge.postToParent = (message) => {
        if (!CHANNEL_ID || !PARENT_ORIGIN) return;
        window.parent.postMessage({ ...message, channelId: CHANNEL_ID }, PARENT_ORIGIN);
    };

    const buildAnnotationPayload = (clientX, clientY, el) => {
        const ratios = documentRatios(clientX, clientY);
        const route = (location.pathname || '/') + (location.search || '') + (location.hash || '');
        let element;
        if (el && el.nodeType === 1) {
            const rect = el.getBoundingClientRect();
            const w = Math.max(rect.width, 1);
            const h = Math.max(rect.height, 1);
            const xRatio = Math.min(1, Math.max(0, (clientX - rect.left) / w));
            const yRatio = Math.min(1, Math.max(0, (clientY - rect.top) / h));
            const pickedId = bridge.register(el);
            const aria = el.getAttribute && (el.getAttribute('aria-label') || undefined);
            element = {
                selector: buildStableSelector(el),
                tagName: (el.tagName || '').toLowerCase(),
                text: truncate((el.textContent || '').replace(/\\s+/g, ' ').trim(), 120) || undefined,
                ariaLabel: aria || undefined,
                rect: {
                    top: Math.round(rect.top),
                    left: Math.round(rect.left),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                },
                xRatio,
                yRatio,
                documentXRatio: ratios.documentXRatio,
                documentYRatio: ratios.documentYRatio,
                pickedId,
                domPath: computeDomPath(el),
                attributes: Array.from(el.attributes || []).slice(0, 24).map(attr => ({ name: attr.name, value: attr.value }))
            };
        }
        return {
            version: 1,
            clientX,
            clientY,
            route,
            pageUrl: location.href,
            element,
            documentXRatio: ratios.documentXRatio,
            documentYRatio: ratios.documentYRatio,
            viewportWidth: window.innerWidth || document.documentElement.clientWidth || 0,
            viewportHeight: window.innerHeight || document.documentElement.clientHeight || 0,
            scrollX: ratios.scrollX,
            scrollY: ratios.scrollY
        };
    };

    const resolveReanchorItem = (item) => {
        const doc = document.documentElement;
        const body = document.body;
        const width = Math.max(doc.scrollWidth || 0, body ? body.scrollWidth : 0, 1);
        const height = Math.max(doc.scrollHeight || 0, body ? body.scrollHeight : 0, 1);
        const scrollX = window.scrollX || doc.scrollLeft || 0;
        const scrollY = window.scrollY || doc.scrollTop || 0;
        if (item.selector) {
            try {
                const el = document.querySelector(item.selector);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    const xRatio = typeof item.xRatio === 'number' ? item.xRatio : 0.5;
                    const yRatio = typeof item.yRatio === 'number' ? item.yRatio : 0.5;
                    return {
                        id: item.id,
                        clientX: rect.left + rect.width * xRatio,
                        clientY: rect.top + rect.height * yRatio,
                        unresolved: false
                    };
                }
            } catch (e) { /* invalid selector */ }
        }
        return {
            id: item.id,
            clientX: item.documentXRatio * width - scrollX,
            clientY: item.documentYRatio * height - scrollY,
            unresolved: true
        };
    };

    let annotateClickHandler = null;
    let annotateKeyHandler = null;

    const deactivateAnnotateListeners = () => {
        if (annotateClickHandler) {
            document.removeEventListener('click', annotateClickHandler, true);
            annotateClickHandler = null;
        }
        if (annotateKeyHandler) {
            document.removeEventListener('keydown', annotateKeyHandler, true);
            annotateKeyHandler = null;
        }
    };

    const activateAnnotateListeners = () => {
        if (annotateClickHandler) return;
        annotateClickHandler = (e) => {
            if (bridge.mode !== 'annotate') return;
            // Allow modifier-free primary click only; scrolling uses touch/wheel (not prevented).
            if (e.button != null && e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            const clientX = e.clientX;
            const clientY = e.clientY;
            const el = document.elementFromPoint(clientX, clientY);
            const payload = buildAnnotationPayload(clientX, clientY, el);
            bridge.postToParent({ type: ANNOTATION_POINT, payload });
        };
        annotateKeyHandler = (e) => {
            if (bridge.mode !== 'annotate') return;
            if (e.key === 'Escape') {
                e.preventDefault();
                bridge.setMode('browse');
                bridge.postToParent({ type: ANNOTATION_CANCEL });
            }
        };
        document.addEventListener('click', annotateClickHandler, true);
        document.addEventListener('keydown', annotateKeyHandler, true);
    };

    bridge.setMode = (mode) => {
        const next = mode === 'annotate' || mode === 'select' || mode === 'browse' ? mode : 'browse';
        bridge.mode = next;
        if (next === 'annotate') {
            activateAnnotateListeners();
        } else {
            deactivateAnnotateListeners();
        }
        return bridge.mode;
    };

    window.${BRIDGE_GLOBAL} = bridge;

    if (!bridge.__qaapMessageBound) {
        bridge.__qaapMessageBound = true;
        window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            if (!CHANNEL_ID || !PARENT_ORIGIN || event.source !== window.parent
                || event.origin !== PARENT_ORIGIN || data.channelId !== CHANNEL_ID) return;
            if (data.type === UPDATE_STYLE && typeof data.id === 'string' && typeof data.prop === 'string') {
                const ok = bridge.applyStyle(data.id, data.prop, String(data.value ?? ''), !!data.important);
                const fresh = ok ? bridge.refresh(data.id) : undefined;
                if (fresh) bridge.postToParent({ type: REFRESH_RES, payload: fresh });
            } else if (data.type === UPDATE_TEXT && typeof data.id === 'string') {
                bridge.applyText(data.id, String(data.text ?? ''));
                const fresh = bridge.refresh(data.id);
                if (fresh) bridge.postToParent({ type: REFRESH_RES, payload: fresh });
            } else if (data.type === REFRESH_REQ && typeof data.id === 'string') {
                const fresh = bridge.refresh(data.id);
                if (fresh) bridge.postToParent({ type: REFRESH_RES, payload: fresh });
            } else if (data.type === SET_MODE) {
                const mode = data.mode || (data.payload && data.payload.mode);
                bridge.setMode(mode);
            } else if (data.type === START_PICKER && typeof data.script === 'string') {
                const pickerScript = document.createElement('script');
                pickerScript.textContent = data.script;
                document.documentElement.appendChild(pickerScript);
                pickerScript.remove();
            } else if (data.type === REANCHOR) {
                const items = (data.payload && data.payload.items) || data.items || [];
                const results = Array.isArray(items) ? items.map(resolveReanchorItem) : [];
                bridge.postToParent({ type: REANCHOR_RES, payload: { items: results } });
            }
        });
    }
})();`;
}

/**
 * Builds the one-shot picker overlay. Requires the bridge to be installed first
 * (see {@link buildElementBridgeScript}). Toggles itself off on click or `Escape`.
 */
export function buildElementPickerScript(): string {
    return `(() => {
    if (window.${PICKER_GLOBAL} && window.${PICKER_GLOBAL}.active) {
        window.${PICKER_GLOBAL}.deactivate();
        return;
    }
    if (!window.${BRIDGE_GLOBAL}) return;
    const bridge = window.${BRIDGE_GLOBAL};
    const MESSAGE_TYPE = ${JSON.stringify(ELEMENT_PICKER_MESSAGE_TYPE)};
    const CANCEL_TYPE = ${JSON.stringify(ELEMENT_PICKER_CANCEL_TYPE)};

    const ensureStyle = () => {
        if (document.getElementById(${JSON.stringify(STYLE_ID)})) return;
        const style = document.createElement('style');
        style.id = ${JSON.stringify(STYLE_ID)};
        style.textContent = \`
            #${OVERLAY_ID} {
                position: fixed; pointer-events: none; z-index: 2147483646;
                box-sizing: border-box; transition: top .06s ease, left .06s ease, width .06s ease, height .06s ease;
                background: rgba(64, 160, 255, 0.18); outline: 2px solid #2f8fff; border-radius: 2px;
            }
            #${LABEL_ID} {
                position: fixed; z-index: 2147483646; pointer-events: none;
                font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                background: #2f8fff; color: #ffffff;
                padding: 2px 6px; border-radius: 3px;
                box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                max-width: 320px; transition: top .06s ease, left .06s ease;
            }
            #${LABEL_ID} .theia-picker-label-tag { font-weight: 600; }
            #${LABEL_ID} .theia-picker-label-id { color: #ffe28a; }
            #${LABEL_ID} .theia-picker-label-cls { color: #c9e4ff; }
            #${LABEL_ID} .theia-picker-label-dim { color: rgba(255, 255, 255, 0.75); margin-left: 8px; font-weight: 400; }
            #${TOOLBAR_ID} {
                position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
                display: flex; align-items: center; gap: 8px;
                padding: 6px 10px; font: 12px/1.4 system-ui, sans-serif;
                background: #1f2329; color: #e8eaed; box-shadow: 0 1px 3px rgba(0,0,0,.35);
                pointer-events: none;
            }
            #${TOOLBAR_ID} kbd { background: #3a3f47; padding: 1px 6px; border-radius: 3px; font-family: inherit; }
        \`;
        document.documentElement.appendChild(style);
    };

    const ensureOverlay = () => {
        let overlay = document.getElementById(${JSON.stringify(OVERLAY_ID)});
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = ${JSON.stringify(OVERLAY_ID)};
            document.documentElement.appendChild(overlay);
        }
        return overlay;
    };

    const ensureLabel = () => {
        let label = document.getElementById(${JSON.stringify(LABEL_ID)});
        if (!label) {
            label = document.createElement('div');
            label.id = ${JSON.stringify(LABEL_ID)};
            document.documentElement.appendChild(label);
        }
        return label;
    };

    const ensureToolbar = () => {
        let bar = document.getElementById(${JSON.stringify(TOOLBAR_ID)});
        if (!bar) {
            bar = document.createElement('div');
            bar.id = ${JSON.stringify(TOOLBAR_ID)};
            bar.innerHTML = '<span>Pick an element</span><span style="opacity:.65">\u2014 click to capture, <kbd>Esc</kbd> to cancel</span>';
            document.documentElement.appendChild(bar);
        }
        return bar;
    };

    const escapeHtml = (s) => String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const buildLabelHtml = (el, rect) => {
        const tag = (el.tagName || '').toLowerCase();
        const idPart = el.id ? '<span class="theia-picker-label-id">#' + escapeHtml(el.id) + '</span>' : '';
        const classList = Array.from(el.classList || []).slice(0, 2);
        const clsPart = classList.length
            ? '<span class="theia-picker-label-cls">.' + classList.map(escapeHtml).join('.') + '</span>'
            : '';
        const dim = '<span class="theia-picker-label-dim">' + Math.round(rect.width) + ' \u00d7 ' + Math.round(rect.height) + '</span>';
        return '<span class="theia-picker-label-tag">' + escapeHtml(tag) + '</span>' + idPart + clsPart + dim;
    };

    const positionLabel = (el, rect) => {
        const label = ensureLabel();
        label.innerHTML = buildLabelHtml(el, rect);
        const labelHeight = 20;
        let top = rect.top - labelHeight - 4;
        if (top < 4) {
            top = rect.top + rect.height + 4;
        }
        let left = rect.left;
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        const labelWidth = Math.min(label.offsetWidth || 200, 320);
        if (left + labelWidth > viewportWidth - 4) {
            left = Math.max(4, viewportWidth - labelWidth - 4);
        }
        if (left < 4) left = 4;
        label.style.top = Math.round(top) + 'px';
        label.style.left = Math.round(left) + 'px';
        label.style.display = 'block';
    };

    const positionOverlay = (el) => {
        const overlay = ensureOverlay();
        const rect = el.getBoundingClientRect();
        overlay.style.top = rect.top + 'px';
        overlay.style.left = rect.left + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
        overlay.style.display = 'block';
        positionLabel(el, rect);
    };

    const state = { active: false, current: null, deactivate: () => {} };

    const onMove = (e) => {
        const target = e.target;
        if (!target || target.nodeType !== 1) return;
        if (target.id === ${JSON.stringify(OVERLAY_ID)}
            || target.id === ${JSON.stringify(LABEL_ID)}
            || target.id === ${JSON.stringify(TOOLBAR_ID)}) return;
        state.current = target;
        positionOverlay(target);
    };

    const onClick = (e) => {
        if (!state.active) return;
        e.preventDefault();
        e.stopPropagation();
        const target = state.current || e.target;
        if (target && target.nodeType === 1) {
            try {
                const pickedId = bridge.register(target);
                const payload = bridge.serialize(target, pickedId);
                bridge.postToParent({ type: MESSAGE_TYPE, payload });
            } catch (err) {
                bridge.postToParent({ type: MESSAGE_TYPE, error: String(err) });
            }
        }
        state.deactivate();
    };

    const onKey = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            bridge.postToParent({ type: CANCEL_TYPE });
            state.deactivate();
        }
    };

    const deactivate = () => {
        if (!state.active) return;
        state.active = false;
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
        const overlay = document.getElementById(${JSON.stringify(OVERLAY_ID)});
        if (overlay) overlay.remove();
        const label = document.getElementById(${JSON.stringify(LABEL_ID)});
        if (label) label.remove();
        const bar = document.getElementById(${JSON.stringify(TOOLBAR_ID)});
        if (bar) bar.remove();
        const style = document.getElementById(${JSON.stringify(STYLE_ID)});
        if (style) style.remove();
    };
    state.deactivate = deactivate;

    ensureStyle();
    ensureOverlay();
    ensureLabel();
    ensureToolbar();
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    state.active = true;
    window.${PICKER_GLOBAL} = state;
})();`;
}
