// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';

const STORAGE_PREFIX = 'qaap.transcript.readPosition.';
const MESSAGE_SELECTOR = '[data-transcript-message-id]';

interface StoredTranscriptReadPosition {
    readonly messageId: string;
    readonly offsetTop: number;
    readonly at: number;
}

function storageKey(conversationId: string): string {
    return `${STORAGE_PREFIX}${conversationId}`;
}

function readStoredPosition(conversationId: string): StoredTranscriptReadPosition | undefined {
    try {
        const raw = window.localStorage.getItem(storageKey(conversationId));
        if (!raw) {
            return undefined;
        }
        const parsed = JSON.parse(raw) as Partial<StoredTranscriptReadPosition>;
        if (typeof parsed.messageId !== 'string' || !parsed.messageId || typeof parsed.offsetTop !== 'number') {
            return undefined;
        }
        return {
            messageId: parsed.messageId,
            offsetTop: parsed.offsetTop,
            at: typeof parsed.at === 'number' ? parsed.at : 0,
        };
    } catch {
        return undefined;
    }
}

function writeStoredPosition(conversationId: string, position: StoredTranscriptReadPosition): void {
    try {
        window.localStorage.setItem(storageKey(conversationId), JSON.stringify(position));
    } catch {
        // localStorage may be disabled; the transcript still works without persistence.
    }
}

export function restoreTranscriptReadPosition(scroller: HTMLElement, conversationId: string): boolean {
    const stored = readStoredPosition(conversationId);
    if (!stored) {
        return false;
    }
    const row = [...scroller.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)]
        .find(candidate => candidate.getAttribute('data-transcript-message-id') === stored.messageId);
    if (!row) {
        return false;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    scroller.scrollTop += rowRect.top - scrollerRect.top - stored.offsetTop;
    return true;
}

export function resolveStoredTranscriptReadMessageIndex(
    conversationId: string,
    messages: readonly { readonly id?: string }[],
): number | undefined {
    const stored = readStoredPosition(conversationId);
    if (!stored) {
        return undefined;
    }
    const index = messages.findIndex(message => message.id === stored.messageId);
    return index >= 0 ? index : undefined;
}

export function attachTranscriptReadPositionPersistence(scroller: HTMLElement, conversationId: string): Disposable {
    let timer: number | undefined;

    const persist = (): void => {
        timer = undefined;
        const scrollerRect = scroller.getBoundingClientRect();
        const row = [...scroller.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)]
            .find(candidate => candidate.getBoundingClientRect().bottom >= scrollerRect.top + 8);
        if (!row) {
            return;
        }
        const messageId = row.getAttribute('data-transcript-message-id');
        if (!messageId) {
            return;
        }
        writeStoredPosition(conversationId, {
            messageId,
            offsetTop: row.getBoundingClientRect().top - scrollerRect.top,
            at: Date.now(),
        });
    };

    const schedule = (): void => {
        if (timer !== undefined) {
            window.clearTimeout(timer);
        }
        timer = window.setTimeout(persist, 180);
    };

    scroller.addEventListener('scroll', schedule, { passive: true });
    window.requestAnimationFrame(persist);

    return Disposable.create(() => {
        if (timer !== undefined) {
            window.clearTimeout(timer);
        }
        persist();
        scroller.removeEventListener('scroll', schedule);
    });
}
