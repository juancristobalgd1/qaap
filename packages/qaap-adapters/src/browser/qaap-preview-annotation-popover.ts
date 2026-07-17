// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { isBlankAnnotationComment, sanitizeAnnotationComment } from './qaap-preview-annotation-store';

export interface MountAnnotationCommentPopoverOptions {
    readonly anchorClientX: number;
    readonly anchorClientY: number;
    readonly panel?: DOMRect;
    readonly initialComment?: string;
    /** Element tag shown as a compact context chip (e.g. `div`). */
    readonly elementTagName?: string;
    readonly allowDelete?: boolean;
    readonly onConfirm: (comment: string) => void;
    readonly onCancel: () => void;
    readonly onDelete?: () => void;
    /** Optional toast when speech recognition is unavailable. */
    readonly onWarn?: (message: string) => void;
}

export interface AnnotationCommentPopoverHandle {
    readonly root: HTMLElement;
    dispose(): void;
    focus(): void;
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

function createIconActionButton(className: string, codicon: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `qaap-preview-annotation-popover-icon-btn ${className}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    const icon = document.createElement('span');
    icon.className = `codicon codicon-${codicon}`;
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);
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
    // Prefer a short tag token; strip leading '<' / trailing '>' if callers pass markup.
    return trimmed.replace(/^<\/?/, '').replace(/>$/, '').toLowerCase();
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

    const elementTag = normalizeElementTagName(options.elementTagName);
    if (elementTag) {
        const chip = document.createElement('span');
        chip.className = 'qaap-preview-annotation-popover-chip';
        chip.setAttribute('aria-hidden', 'true');
        const chipIcon = document.createElement('span');
        chipIcon.className = 'codicon codicon-inspect qaap-preview-annotation-popover-chip-icon';
        const chipLabel = document.createElement('span');
        chipLabel.className = 'qaap-preview-annotation-popover-chip-label';
        chipLabel.textContent = elementTag;
        chip.append(chipIcon, chipLabel);
        body.append(chip);
    }

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
    const micBtn = createIconActionButton('qaap-preview-annotation-popover-mic', 'mic', micStartLabel);
    micBtn.setAttribute('aria-pressed', 'false');

    const cancelLabel = nls.localizeByDefault('Cancel');
    const cancelBtn = createIconActionButton('qaap-preview-annotation-popover-cancel', 'close', cancelLabel);

    const confirmLabel = nls.localize('qaap/preview/annotationConfirm', 'Confirm');
    const confirmBtn = createIconActionButton('qaap-preview-annotation-popover-confirm', 'arrow-up', confirmLabel);

    actions.append(cancelBtn, micBtn, confirmBtn);

    if (options.allowDelete && options.onDelete) {
        const deleteLabel = nls.localizeByDefault('Delete');
        const deleteBtn = createIconActionButton('qaap-preview-annotation-popover-delete', 'trash', deleteLabel);
        deleteBtn.addEventListener('click', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            stopDictation();
            options.onDelete?.();
            dispose();
        });
        actions.prepend(deleteBtn);
    }

    root.append(title, body, actions);
    document.body.append(root);

    let recognition: SpeechRecognitionLike | undefined;
    let dictationActive = false;
    let dictationBaseline = '';
    let dictationTrailing = '';

    const markMicIdle = (): void => {
        micBtn.classList.remove('qaap-preview-annotation-popover-mic--listening');
        micBtn.setAttribute('aria-pressed', 'false');
        micBtn.title = micStartLabel;
        micBtn.setAttribute('aria-label', micStartLabel);
        const icon = micBtn.querySelector('.codicon');
        if (icon) {
            icon.classList.remove('codicon-stop-circle');
            icon.classList.add('codicon-mic');
        }
    };

    const markMicListening = (): void => {
        micBtn.classList.add('qaap-preview-annotation-popover-mic--listening');
        micBtn.setAttribute('aria-pressed', 'true');
        micBtn.title = micStopLabel;
        micBtn.setAttribute('aria-label', micStopLabel);
        const icon = micBtn.querySelector('.codicon');
        if (icon) {
            icon.classList.remove('codicon-mic');
            icon.classList.add('codicon-stop-circle');
        }
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
        root.classList.toggle('qaap-preview-annotation-popover--expanded', hasText || multiLine);
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
                // Fatal and recoverable errors both end the session for this compact UI.
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

    const onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
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
        if (target && root.contains(target)) {
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
            // Manual edits end the current dictation baseline session.
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
        const width = root.offsetWidth || (mobile ? Math.min(340, bounds.width - margin * 2) : 320);
        const height = root.offsetHeight || 44;

        // Prefer beside/below the marker; flip when it would leave the panel.
        let left = options.anchorClientX + gap;
        let top = options.anchorClientY + gap;
        if (left + width > bounds.right - margin) {
            left = options.anchorClientX - width - gap;
        }
        if (top + height > bounds.bottom - margin) {
            top = options.anchorClientY - height - gap;
        }
        // Keep floating near the marker; nudge up into the visual viewport when the keyboard covers it.
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
    };
}

export function canConfirmAnnotationComment(raw: string): boolean {
    return !isBlankAnnotationComment(raw);
}
