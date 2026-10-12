// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { getConversation } from '../common/qaap-agent-conversation-client';
import {
    QaapLiveFeedCursor,
    isQaapLiveV2Enabled,
    type QaapLiveFeedFrame,
    type QaapLiveFeedSink,
    type QaapLiveFeedStorage,
} from '../common/qaap-live-feed-cursor';
import type { ConversationServerEvent } from './mobile-projects-conversations';
import type { MobileProjectsConversationsContext } from './mobile-projects-conversations-context';

function browserStorage(kind: 'sessionStorage' | 'localStorage'): QaapLiveFeedStorage | undefined {
    try {
        return typeof window === 'undefined' ? undefined : window[kind];
    } catch {
        return undefined;
    }
}

/** True unless the `qaap.liveV2=0` kill switch is set (sessionStorage or localStorage; every access guarded). */
export function liveV2EnabledExtracted(): boolean {
    return isQaapLiveV2Enabled(browserStorage('sessionStorage'), browserStorage('localStorage'));
}

/** The protocol-v2 cursor, created on first use; `undefined` when the kill switch selects v1. */
export function ensureLiveFeedExtracted(ctx: MobileProjectsConversationsContext): QaapLiveFeedCursor | undefined {
    if (!ctx.liveFeedResolved) {
        ctx.liveFeedResolved = true;
        if (liveV2EnabledExtracted()) {
            ctx.liveFeed = new QaapLiveFeedCursor(createSink(ctx), browserStorage('sessionStorage'));
        }
    }
    return ctx.liveFeed;
}

function createSink(ctx: MobileProjectsConversationsContext): QaapLiveFeedSink {
    return {
        send: op => {
            if (ctx.socket?.readyState !== WebSocket.OPEN) {
                return false;
            }
            ctx.socket.send(JSON.stringify(op));
            return true;
        },
        applyResync: frame => {
            ctx.dispatchServerPayload({ type: 'resync', epoch: frame.epoch ?? '', seq: frame.seq ?? 0, groups: frame.groups ?? [] } as unknown as ConversationServerEvent);
        },
        applyFrame: frame => ctx.dispatchServerPayload(frame as unknown as ConversationServerEvent),
        // The document cache hook reports the document's cursor to the feed (noteDocument).
        fetchThread: async id => {
            const document = await getConversation(id);
            ctx.cacheDocument(document);
        },
    };
}

/** Routes a transport frame through the v2 cursor, or straight to the v1 dispatcher when v2 is off. */
export function routeLiveFrameExtracted(ctx: MobileProjectsConversationsContext, payload: QaapLiveFeedFrame, sseEventId?: string, viaSse = false): void {
    const feed = ctx.liveFeed;
    if (!feed) {
        ctx.dispatchServerPayload(payload as unknown as ConversationServerEvent);
    } else if (viaSse) {
        feed.handleSseFrame(payload, sseEventId);
    } else {
        feed.handleFrame(payload);
    }
}

/**
 * Declares that `id`'s live messages are needed (open transcript). Reference counted, so several
 * views can share a thread; the last release unfocuses it.
 */
export function focusThreadExtracted(ctx: MobileProjectsConversationsContext, id: string): Disposable {
    const feed = ensureLiveFeedExtracted(ctx);
    if (!feed || !id || id.startsWith('pending-')) {
        return Disposable.NULL;
    }
    ctx.focusRefs.set(id, (ctx.focusRefs.get(id) ?? 0) + 1);
    feed.focus(id);
    let released = false;
    return Disposable.create(() => {
        if (released) {
            return;
        }
        released = true;
        const remaining = (ctx.focusRefs.get(id) ?? 1) - 1;
        if (remaining > 0) {
            ctx.focusRefs.set(id, remaining);
            return;
        }
        ctx.focusRefs.delete(id);
        feed.unfocus(id);
    });
}
