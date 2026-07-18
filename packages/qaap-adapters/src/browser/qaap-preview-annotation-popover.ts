// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { isBlankAnnotationComment, sanitizeAnnotationComment } from './qaap-preview-annotation-store';

/**
 * Cursor-style annotation comment popover (empty pill → expanded card).
 * Work Hub may attach sticky-composer agent/model controls via {@link composerSession}.
 */

/** Handle returned by {@link AnnotationComposerSessionControls.attach}. */
export interface AnnotationComposerSessionAttachment {
    dispose(): void;
}

/**
 * Optional Work Hub agent/model chrome for the expanded popover footer.
 * Implemented in mobile-shell so sheets/preferences stay shared with the sticky composer.
 */
export interface AnnotationComposerSessionControls {
    attach(host: HTMLElement): AnnotationComposerSessionAttachment;
}

/** One element reference chip in the annotate popover (tag + optional id/detail). */
export interface AnnotationPopoverElementRef {
    readonly tagName: string;
    /** Optional short identifier shown after the tag (e.g. DOM id / hash). */
    readonly detail?: string;
}

export interface MountAnnotationCommentPopoverOptions {
    readonly anchorClientX: number;
    readonly anchorClientY: number;
    readonly panel?: DOMRect;
    readonly initialComment?: string;
    /**
     * Element tags shown as compact context chips (multi-select annotate).
     * Prefer this over {@link elementTagName}.
     */
    readonly elementRefs?: readonly AnnotationPopoverElementRef[];
    /** @deprecated Prefer {@link elementRefs}. Single element tag chip (e.g. `div`). */
    readonly elementTagName?: string;
    readonly allowDelete?: boolean;
    readonly onConfirm: (comment: string) => void;
    readonly onCancel: () => void;
    readonly onDelete?: () => void;
    /** Optional toast when speech recognition is unavailable. */
    readonly onWarn?: (message: string) => void;
    /** Work Hub sticky-composer agent/model controls (compact footer chips). */
    readonly composerSession?: AnnotationComposerSessionControls;
}

export interface AnnotationCommentPopoverHandle {
    readonly root: HTMLElement;
    dispose(): void;
    focus(): void;
    /** Confirms the current non-blank draft (same as tapping ✓); returns false when blank. */
    commit(): boolean;
    /** Current textarea draft (unsanitized raw value). */
    getComment(): string;
    /** Replace the element-reference chips without remounting (keeps textarea focus/text). */
    setElementRefs(refs: readonly AnnotationPopoverElementRef[]): void;
}

const NARROW_QUERY = '(max-width: 767px), (pointer: coarse)';
const SINGLE_LINE_HEIGHT_PX = 22;
const MAX_INPUT_HEIGHT_PX = 140;

interface SpeechRecognitionLike extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
    onend: ((event: Event) => void) | null;
    start(): void;
    stop(): void;
}

interface SpeechRecognitionResultEvent {
    readonly results: ArrayLike<{ readonly isFinal?: boolean; readonly 0?: { readonly transcript?: string } }>;
    readonly resultIndex: number;
}

interface SpeechRecognitionErrorLike extends Event {
    readonly error?: string;
}

export function getAnnotationSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }
    const w = window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) {
        el.setAttribute(key, value);
    }
    return el;
}

/**
 * Cursor-style element target: periwinkle rounded square with a hollow triangular
 * pointer in the bottom-left corner, aiming diagonally toward the frame center.
 */
function createElementTargetSvg(className: string): SVGSVGElement {
    const svg = svgEl('svg', {
        viewBox: '0 0 16 16',
        width: '14',
        height: '14',
        'aria-hidden': 'true',
        focusable: 'false',
    }) as SVGSVGElement;
    svg.classList.add(className);

    // Rounded selection frame.
    svg.append(svgEl('rect', {
        x: '2.75',
        y: '2.25',
        width: '10.5',
        height: '10.5',
        rx: '2.1',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.35',
    }));
    // Hollow wedge in the bottom-left, tip pointing up-center into the frame.
    svg.append(svgEl('path', {
        d: 'M4.55 11.85 L4.55 7.15 L9.1 11.85 Z',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.3',
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
    }));
    return svg;
}

function createMicSvg(): SVGSVGElement {
    const svg = svgEl('svg', {
        viewBox: '0 0 16 16',
        width: '16',
        height: '16',
        'aria-hidden': 'true',
        focusable: 'false',
    }) as SVGSVGElement;
    svg.classList.add('qaap-preview-annotation-popover-glyph');
    // Capsule mic body.
    svg.append(svgEl('rect', {
        x: '5.5', y: '1.5', width: '5', height: '8', rx: '2.5',
        fill: 'currentColor',
    }));
    // Stand arc + stem.
    svg.append(svgEl('path', {
        d: 'M3.25 7.25 A4.75 4.75 0 0 0 12.75 7.25 M8 12 v2.25 M5.5 14.25 h5',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.35',
        'stroke-linecap': 'round',
    }));
    return svg;
}

function createStopSvg(): SVGSVGElement {
    const svg = svgEl('svg', {
        viewBox: '0 0 16 16',
        width: '16',
        height: '16',
        'aria-hidden': 'true',
        focusable: 'false',
    }) as SVGSVGElement;
    svg.classList.add('qaap-preview-annotation-popover-glyph');
    svg.append(svgEl('circle', {
        cx: '8', cy: '8', r: '6',
        fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4',
    }));
    svg.append(svgEl('rect', {
        x: '5.25', y: '5.25', width: '5.5', height: '5.5', rx: '1',
        fill: 'currentColor',
    }));
    return svg;
}

function createCheckSvg(): SVGSVGElement {
    const svg = svgEl('svg', {
        viewBox: '0 0 16 16',
        width: '15',
        height: '15',
        'aria-hidden': 'true',
        focusable: 'false',
    }) as SVGSVGElement;
    svg.classList.add('qaap-preview-annotation-popover-glyph');
    svg.append(svgEl('path', {
        d: 'M3.6 8.2 L6.7 11.2 L12.5 4.6',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.75',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
    }));
    return svg;
}

function createCloseSvg(): SVGSVGElement {
    const svg = svgEl('svg', {
        viewBox: '0 0 16 16',
        width: '14',
        height: '14',
        'aria-hidden': 'true',
        focusable: 'false',
    }) as SVGSVGElement;
    svg.classList.add('qaap-preview-annotation-popover-glyph');
    svg.append(svgEl('path', {
        d: 'M4 4 L12 12 M12 4 L4 12',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.6',
        'stroke-linecap': 'round',
    }));
    return svg;
}

function createTrashSvg(): SVGSVGElement {
    const svg = svgEl('svg', {
        viewBox: '0 0 16 16',
        width: '14',
        height: '14',
        'aria-hidden': 'true',
        focusable: 'false',
    }) as SVGSVGElement;
    svg.classList.add('qaap-preview-annotation-popover-glyph');
    svg.append(svgEl('path', {
        d: 'M3.5 4.5 h9 M6 4.5 V3.25 h4 V4.5 M5 4.5 l.6 8.25 h4.8 L11 4.5',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.35',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
    }));
    return svg;
}

function createIconButton(className: string, label: string, glyph: SVGSVGElement): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `qaap-preview-annotation-popover-icon-btn ${className}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(glyph);
    return button;
}

function preferredSpeechLang(): string {
    if (typeof navigator !== 'undefined' && navigator.language) {
        return navigator.language;
    }
    return 'en-US';
}

function buildTranscriptFromEvent(event: SpeechRecognitionResultEvent): string {
    let transcript = '';
    for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0]?.transcript ?? '';
    }
    return transcript;
}

function trailingSpaceForBaseline(baseline: string): string {
    return baseline.length > 0 && !/\s$/.test(baseline) ? ' ' : '';
}

function normalizeElementTagName(raw: string | undefined): string | undefined {
    const trimmed = raw?.trim();
    if (!trimmed) {
        return undefined;
    }
    return trimmed.replace(/^<\/?/, '').replace(/>$/, '').toLowerCase();
}

function normalizeElementRefs(
    refs: readonly AnnotationPopoverElementRef[] | undefined,
    legacyTagName: string | undefined,
): AnnotationPopoverElementRef[] {
    if (refs && refs.length > 0) {
        return refs
            .map(ref => {
                const tagName = normalizeElementTagName(ref.tagName);
                if (!tagName) {
                    return undefined;
                }
                const detail = ref.detail?.trim();
                return detail ? { tagName, detail } : { tagName };
            })
            .filter((ref): ref is AnnotationPopoverElementRef => !!ref);
    }
    const legacy = normalizeElementTagName(legacyTagName);
    return legacy ? [{ tagName: legacy }] : [];
}

function createElementRefChip(ref: AnnotationPopoverElementRef, toneIndex: number): HTMLSpanElement {
    const chip = document.createElement('span');
    chip.className = 'qaap-preview-annotation-popover-chip';
    chip.dataset.chipTone = String(toneIndex % 4);
    chip.setAttribute('aria-hidden', 'true');
    chip.append(createElementTargetSvg('qaap-preview-annotation-popover-chip-icon'));
    const chipLabel = document.createElement('span');
    chipLabel.className = 'qaap-preview-annotation-popover-chip-label';
    const tagEl = document.createElement('span');
    tagEl.className = 'qaap-preview-annotation-popover-chip-tag';
    tagEl.textContent = ref.tagName;
    chipLabel.append(tagEl);
    if (ref.detail) {
        const detailEl = document.createElement('span');
        detailEl.className = 'qaap-preview-annotation-popover-chip-detail';
        detailEl.textContent = ref.detail;
        chipLabel.append(detailEl);
    }
    chip.append(chipLabel);
    return chip;
}

export function mountAnnotationCommentPopover(options: MountAnnotationCommentPopoverOptions): AnnotationCommentPopoverHandle {
    const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mobile = typeof matchMedia === 'function' && matchMedia(NARROW_QUERY).matches;

    const root = document.createElement('div');
    root.className = 'qaap-preview-annotation-popover';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', nls.localize('qaap/preview/annotationCommentTitle', 'Comment'));
    if (reducedMotion) {
        root.classList.add('qaap-preview-annotation-popover--reduced-motion');
    }

    const title = document.createElement('div');
    title.className = 'qaap-preview-annotation-popover-title';
    title.textContent = nls.localize('qaap/preview/annotationCommentTitle', 'Comment');

    const body = document.createElement('div');
    body.className = 'qaap-preview-annotation-popover-body';

    const chipsHost = document.createElement('div');
    chipsHost.className = 'qaap-preview-annotation-popover-chips';
    chipsHost.hidden = true;

    const renderElementRefs = (refs: readonly AnnotationPopoverElementRef[]): void => {
        chipsHost.replaceChildren();
        refs.forEach((ref, index) => {
            chipsHost.append(createElementRefChip(ref, index));
        });
        chipsHost.hidden = refs.length === 0;
    };
    renderElementRefs(normalizeElementRefs(options.elementRefs, options.elementTagName));
    body.append(chipsHost);

    const placeholder = nls.localize('qaap/preview/annotationCommentPlaceholder', 'Describe the change');
    const textarea = document.createElement('textarea');
    textarea.className = 'qaap-preview-annotation-popover-input';
    textarea.placeholder = placeholder;
    textarea.value = options.initialComment ?? '';
    textarea.rows = 1;
    textarea.setAttribute('aria-label', placeholder);
    body.append(textarea);

    const actions = document.createElement('div');
    actions.className = 'qaap-preview-annotation-popover-actions';

    const micStartLabel = nls.localize('qaap/preview/annotationMicStart', 'Dictate with microphone');
    const micStopLabel = nls.localize('qaap/preview/annotationMicStop', 'Stop dictation');
    const micBtn = createIconButton('qaap-preview-annotation-popover-mic', micStartLabel, createMicSvg());
    micBtn.setAttribute('aria-pressed', 'false');

    const cancelLabel = nls.localizeByDefault('Cancel');
    const cancelBtn = createIconButton('qaap-preview-annotation-popover-cancel', cancelLabel, createCloseSvg());

    const confirmLabel = nls.localize('qaap/preview/annotationConfirm', 'Confirm');
    const confirmBtn = createIconButton('qaap-preview-annotation-popover-confirm', confirmLabel, createCheckSvg());

    const spacer = document.createElement('span');
    spacer.className = 'qaap-preview-annotation-popover-actions-spacer';
    spacer.setAttribute('aria-hidden', 'true');

    // Footer (expanded): [× close] [delete?] [agent/model?] | spacer | gray mic | white send
    // Empty: CSS hides cancel/send/spacer/session — only white mic remains on the right.
    actions.append(cancelBtn);

    if (options.allowDelete && options.onDelete) {
        const deleteLabel = nls.localizeByDefault('Delete');
        const deleteBtn = createIconButton('qaap-preview-annotation-popover-delete', deleteLabel, createTrashSvg());
        deleteBtn.addEventListener('click', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            stopDictation();
            options.onDelete?.();
            dispose();
        });
        actions.append(deleteBtn);
    }

    let sessionAttachment: AnnotationComposerSessionAttachment | undefined;
    if (options.composerSession) {
        const sessionHost = document.createElement('div');
        sessionHost.className = 'qaap-preview-annotation-popover-session';
        sessionAttachment = options.composerSession.attach(sessionHost);
        actions.append(sessionHost);
    }

    actions.append(spacer, micBtn, confirmBtn);
    root.append(title, body, actions);
    document.body.append(root);

    let recognition: SpeechRecognitionLike | undefined;
    let dictationActive = false;
    let dictationBaseline = '';
    let dictationTrailing = '';

    const setMicGlyph = (listening: boolean): void => {
        micBtn.replaceChildren(listening ? createStopSvg() : createMicSvg());
    };

    const markMicIdle = (): void => {
        micBtn.classList.remove('qaap-preview-annotation-popover-mic--listening');
        micBtn.setAttribute('aria-pressed', 'false');
        micBtn.title = micStartLabel;
        micBtn.setAttribute('aria-label', micStartLabel);
        setMicGlyph(false);
    };

    const markMicListening = (): void => {
        micBtn.classList.add('qaap-preview-annotation-popover-mic--listening');
        micBtn.setAttribute('aria-pressed', 'true');
        micBtn.title = micStopLabel;
        micBtn.setAttribute('aria-label', micStopLabel);
        setMicGlyph(true);
    };

    const stopDictation = (): void => {
        dictationActive = false;
        if (recognition) {
            try {
                recognition.onend = null;
                recognition.onresult = null;
                recognition.onerror = null;
                recognition.stop();
            } catch { /* idempotent */ }
            recognition = undefined;
        }
        markMicIdle();
    };

    const syncExpandedState = (): void => {
        const hasText = textarea.value.trim().length > 0;
        const multiLine = textarea.scrollHeight > SINGLE_LINE_HEIGHT_PX + 4;
        const multiChip = chipsHost.childElementCount > 1;
        root.classList.toggle('qaap-preview-annotation-popover--expanded', hasText || multiLine || multiChip);
    };

    const autosizeInput = (): void => {
        textarea.style.height = 'auto';
        const contentHeight = textarea.scrollHeight;
        const next = Math.min(Math.max(contentHeight, SINGLE_LINE_HEIGHT_PX), MAX_INPUT_HEIGHT_PX);
        textarea.style.height = `${next}px`;
        textarea.style.overflowY = contentHeight > MAX_INPUT_HEIGHT_PX ? 'auto' : 'hidden';
        syncExpandedState();
    };

    const applyDictationTranscript = (transcript: string): void => {
        const next = dictationBaseline + dictationTrailing + transcript;
        if (textarea.value === next) {
            return;
        }
        textarea.value = next;
        const end = next.length;
        try {
            textarea.setSelectionRange(end, end);
        } catch { /* ignore */ }
        autosizeInput();
        position();
    };

    const startDictation = (): void => {
        const Ctor = getAnnotationSpeechRecognitionCtor();
        if (!Ctor) {
            options.onWarn?.(nls.localize(
                'qaap/preview/annotationMicUnavailable',
                'Voice dictation is not available in this browser.',
            ));
            micBtn.disabled = true;
            return;
        }
        dictationBaseline = textarea.value;
        dictationTrailing = trailingSpaceForBaseline(dictationBaseline);
        try {
            const rec = new Ctor();
            recognition = rec;
            rec.continuous = true;
            rec.interimResults = true;
            rec.lang = preferredSpeechLang();
            rec.onresult = (event: SpeechRecognitionResultEvent) => {
                if (!dictationActive) {
                    return;
                }
                applyDictationTranscript(buildTranscriptFromEvent(event));
            };
            rec.onerror = () => {
                stopDictation();
            };
            rec.onend = () => {
                recognition = undefined;
                if (dictationActive) {
                    dictationActive = false;
                    markMicIdle();
                }
            };
            dictationActive = true;
            markMicListening();
            rec.start();
        } catch {
            recognition = undefined;
            dictationActive = false;
            markMicIdle();
            options.onWarn?.(nls.localize(
                'qaap/preview/annotationMicUnavailable',
                'Voice dictation is not available in this browser.',
            ));
        }
    };

    const toggleDictation = (): void => {
        if (dictationActive) {
            stopDictation();
            return;
        }
        startDictation();
    };

    if (!getAnnotationSpeechRecognitionCtor()) {
        micBtn.disabled = true;
        micBtn.title = nls.localize(
            'qaap/preview/annotationMicUnavailable',
            'Voice dictation is not available in this browser.',
        );
        micBtn.setAttribute('aria-label', micBtn.title);
    }

    const confirm = (): void => {
        stopDictation();
        const comment = sanitizeAnnotationComment(textarea.value);
        if (!comment) {
            textarea.focus();
            return;
        }
        options.onConfirm(comment);
        dispose();
    };

    const requestCancel = (): void => {
        const draft = sanitizeAnnotationComment(textarea.value);
        const initial = sanitizeAnnotationComment(options.initialComment ?? '');
        if (draft && draft !== initial) {
            const discard = window.confirm(nls.localize(
                'qaap/preview/annotationDiscardConfirm',
                'Discard this comment?',
            ));
            if (!discard) {
                return;
            }
        }
        stopDictation();
        options.onCancel();
        dispose();
    };

    const isAgentPickerSurfaceOpen = (): boolean => !!document.querySelector(
        '.qaap-sticky-composer-sheet-popover, .theia-mobile-sticky-composer-sheet, .theia-mobile-projects-sticky-composer-sheet',
    );

    const onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            // Agent/model picker owns Escape first; keep the annotation draft intact.
            if (isAgentPickerSurfaceOpen()) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            requestCancel();
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            confirm();
        }
    };

    const onOutside = (e: MouseEvent): void => {
        const target = e.target as Node | null;
        if (!target) {
            return;
        }
        if (root.contains(target)) {
            return;
        }
        // Agent/model sheets mount on body — ignore those clicks. The annotate toolbar is also
        // exempt: its Send button commits the open draft itself, and prompting "Discard this
        // comment?" from its mousedown would block Send behind a modal (renderer freeze on
        // embedded panes) and silently drop the user's draft.
        if (target instanceof Element && target.closest(
            [
                '.qaap-sticky-composer-sheet-popover',
                '.theia-mobile-sticky-composer-sheet',
                '.theia-mobile-projects-sticky-composer-sheet',
                '.qaap-sticky-composer-popover',
                '.qaap-preview-annotate-toolbar',
            ].join(', '),
        )) {
            return;
        }
        requestCancel();
    };

    micBtn.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        toggleDictation();
    });
    confirmBtn.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        confirm();
    });
    cancelBtn.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        requestCancel();
    });
    textarea.addEventListener('keydown', onKeyDown);
    textarea.addEventListener('input', () => {
        if (dictationActive) {
            stopDictation();
        }
        autosizeInput();
        position();
    });

    const visibleBounds = (): DOMRect => {
        const panel = options.panel ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
        const vv = window.visualViewport;
        if (!vv) {
            return panel;
        }
        const left = Math.max(panel.left, vv.offsetLeft);
        const top = Math.max(panel.top, vv.offsetTop);
        const right = Math.min(panel.right, vv.offsetLeft + vv.width);
        const bottom = Math.min(panel.bottom, vv.offsetTop + vv.height);
        if (right <= left || bottom <= top) {
            return panel;
        }
        return new DOMRect(left, top, right - left, bottom - top);
    };

    const position = (): void => {
        const margin = 8;
        const gap = 10;
        const bounds = visibleBounds();
        const width = root.offsetWidth || (mobile ? Math.min(360, bounds.width - margin * 2) : 340);
        const height = root.offsetHeight || 44;

        let left = options.anchorClientX + gap;
        let top = options.anchorClientY + gap;
        if (left + width > bounds.right - margin) {
            left = options.anchorClientX - width - gap;
        }
        if (top + height > bounds.bottom - margin) {
            top = options.anchorClientY - height - gap;
        }
        left = Math.max(bounds.left + margin, Math.min(left, bounds.right - width - margin));
        top = Math.max(bounds.top + margin, Math.min(top, bounds.bottom - height - margin));
        root.style.left = `${Math.round(left)}px`;
        root.style.top = `${Math.round(top)}px`;
        root.style.bottom = 'auto';
        root.style.right = 'auto';
        root.style.width = '';
    };

    autosizeInput();
    position();
    const schedule = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : ((cb: FrameRequestCallback) => window.setTimeout(() => cb(Date.now()), 0) as unknown as number);
    schedule(() => {
        autosizeInput();
        position();
        document.addEventListener('mousedown', onOutside, true);
        textarea.focus();
        const len = textarea.value.length;
        textarea.setSelectionRange(len, len);
    });

    const onViewportChange = (): void => {
        position();
    };
    window.addEventListener('resize', onViewportChange);
    window.visualViewport?.addEventListener('resize', onViewportChange);
    window.visualViewport?.addEventListener('scroll', onViewportChange);

    const dispose = (): void => {
        stopDictation();
        sessionAttachment?.dispose();
        sessionAttachment = undefined;
        document.removeEventListener('mousedown', onOutside, true);
        window.removeEventListener('resize', onViewportChange);
        window.visualViewport?.removeEventListener('resize', onViewportChange);
        window.visualViewport?.removeEventListener('scroll', onViewportChange);
        root.remove();
    };

    return {
        root,
        dispose,
        focus: () => textarea.focus(),
        commit: () => {
            const comment = sanitizeAnnotationComment(textarea.value);
            if (!comment) {
                return false;
            }
            confirm();
            return true;
        },
        getComment: () => textarea.value,
        setElementRefs: (refs: readonly AnnotationPopoverElementRef[]): void => {
            renderElementRefs(normalizeElementRefs(refs, undefined));
            syncExpandedState();
            position();
        },
    };
}

export function canConfirmAnnotationComment(raw: string): boolean {
    return !isBlankAnnotationComment(raw);
}
