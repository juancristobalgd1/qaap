// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Where a conversation came from when it is not a plain thread: only a side chat today. */
type SideChatOrigin = 'side-chat';

/** Longest conversation id a side chat may reference (ids are UUIDs). */
const SIDE_CHAT_PARENT_ID_MAX_LENGTH = 128;
const SIDE_CHAT_PARENT_ID_PATTERN = /^[A-Za-z0-9-]+$/;

export interface QaapSideChatCreateFields {
    readonly origin?: SideChatOrigin;
    readonly sideChatParentId?: string;
}

/**
 * Reads the side chat fields of a create request. Anything that is not exactly the side chat origin is
 * dropped, so a plain conversation never gets the marker. A parent id must look like an id; a malformed one
 * is dropped and the side chat is still created. The parent is only stored as a reference: the server
 * does not read its content here, and the browser reads it through the owner-checked conversation API.
 */
export function parseSideChatCreateFields(body: { readonly origin?: unknown; readonly sideChatParentId?: unknown } | undefined): QaapSideChatCreateFields {
    if (body?.origin !== 'side-chat') {
        return {};
    }
    const parent = typeof body.sideChatParentId === 'string' ? body.sideChatParentId.trim() : '';
    const validParent = parent.length > 0 && parent.length <= SIDE_CHAT_PARENT_ID_MAX_LENGTH && SIDE_CHAT_PARENT_ID_PATTERN.test(parent);
    return validParent
        ? { origin: 'side-chat', sideChatParentId: parent }
        : { origin: 'side-chat' };
}

/** Total budget of the parent context in characters (about 4-6k, split between the last prompt and reply). */
export const QAAP_SIDE_CHAT_CONTEXT_CHAR_LIMIT = 5000;

/**
 * Longest context preamble a side chat create request may carry. The browser sends at most
 * {@link QAAP_SIDE_CHAT_CONTEXT_CHAR_LIMIT}; the server accepts a little more and rejects the rest.
 */
export const QAAP_SIDE_CHAT_CONTEXT_PREAMBLE_MAX_LENGTH = 8000;

/** The opening of the context preamble, as {@link buildSideChatContextPreamble} writes it. */
export const QAAP_SIDE_CHAT_PREAMBLE_OPENING = 'Background from the conversation "';
/** The line that ends the preamble, as {@link composeSideChatPrompt} writes it. */
export const QAAP_SIDE_CHAT_PREAMBLE_SEPARATOR = '\n\n---\n\n';

/** Longest title a side chat shows in a list, in characters, before it is cut with an ellipsis. */
const SIDE_CHAT_VISIBLE_TITLE_LIMIT = 48;

/**
 * Validates the hidden context preamble of a side chat create request. `undefined` or blank is no preamble;
 * a non-string or a value over {@link QAAP_SIDE_CHAT_CONTEXT_PREAMBLE_MAX_LENGTH} is rejected, so the create
 * fails with a clear message instead of storing an oversized prompt.
 */
export function parseSideChatContextPreamble(value: unknown): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new Error('contextPreamble must be a string.');
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }
    if (trimmed.length > QAAP_SIDE_CHAT_CONTEXT_PREAMBLE_MAX_LENGTH) {
        throw new Error(`contextPreamble is longer than ${QAAP_SIDE_CHAT_CONTEXT_PREAMBLE_MAX_LENGTH} characters.`);
    }
    return trimmed;
}

export interface QaapSideChatContextMessage {
    readonly role: 'user' | 'agent';
    readonly text: string;
}

export interface QaapSideChatContextSource {
    readonly title: string;
    readonly messages: readonly QaapSideChatContextMessage[];
}

/** Trims to `limit` characters, marking the cut. */
export function clipSideChatText(text: string, limit: number): string {
    const trimmed = text.trim();
    return trimmed.length > limit ? `${trimmed.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : trimmed;
}

/**
 * The user's own words of a stored user message. Conversations made before the context preamble was a
 * hidden field kept it in the message text; the preamble is removed here, nested copies included, so the
 * transcript, the side chat bubble and the list titles show only what the user typed. Text without the
 * marker is returned unchanged.
 *
 * The user's words are what follows the last separator: the preamble never ends with one, and a copy
 * nested inside another preamble sits before the outer separator.
 */
export function stripSideChatPreamble(content: string): string {
    let text = content;
    while (text.startsWith(QAAP_SIDE_CHAT_PREAMBLE_OPENING)) {
        const at = text.lastIndexOf(QAAP_SIDE_CHAT_PREAMBLE_SEPARATOR);
        if (at < 0) {
            // A cut title keeps the opening but not the separator: no user words survive, the caller decides.
            break;
        }
        text = text.slice(at + QAAP_SIDE_CHAT_PREAMBLE_SEPARATOR.length);
    }
    return text;
}

/**
 * The title a side chat shows in a list. A stored title that still starts with the preamble (made before the
 * hidden field) is replaced by the first user message's own words, when they can be read. Returns `''` when
 * the title is such a preamble and no user words are left: the list then shows the side chat's label.
 * Other titles are returned unchanged.
 */
export function sideChatVisibleTitle(title: string, firstUserContent?: string): string {
    if (!title.startsWith(QAAP_SIDE_CHAT_PREAMBLE_OPENING)) {
        return title;
    }
    const words = firstUserContent === undefined ? '' : stripSideChatPreamble(firstUserContent).replace(/\s+/g, ' ').trim();
    if (!words || words.startsWith(QAAP_SIDE_CHAT_PREAMBLE_OPENING)) {
        return '';
    }
    return words.length > SIDE_CHAT_VISIBLE_TITLE_LIMIT
        ? `${words.slice(0, SIDE_CHAT_VISIBLE_TITLE_LIMIT - 1).trimEnd()}…`
        : words;
}

/**
 * The background a side chat gets with its first message: the parent's title, its last user prompt and its
 * last agent reply, each clipped so the whole stays within {@link QAAP_SIDE_CHAT_CONTEXT_CHAR_LIMIT}.
 * Old preambles inside the parent's own prompt are removed before it is quoted, and a parent title that is
 * still a preamble falls back to a generic name. `undefined` when the parent has no turn to show.
 */
export function buildSideChatContextPreamble(source: QaapSideChatContextSource, limit = QAAP_SIDE_CHAT_CONTEXT_CHAR_LIMIT): string | undefined {
    const turns = source.messages.map(message => ({ role: message.role, text: message.role === 'user' ? stripSideChatPreamble(message.text) : message.text }));
    const lastUser = [...turns].reverse().find(message => message.role === 'user' && message.text.trim());
    const lastAgent = [...turns].reverse().find(message => message.role === 'agent' && message.text.trim());
    if (!lastUser && !lastAgent) {
        return undefined;
    }
    const visibleTitle = sideChatVisibleTitle(source.title);
    const title = clipSideChatText(visibleTitle || 'Untitled conversation', 200);
    const half = Math.floor(limit / 2);
    const parts = [
        `Background from the conversation "${title}" this side chat was opened from. Use it only as context.`,
    ];
    if (lastUser) {
        parts.push(`Last user request:\n${clipSideChatText(lastUser.text, half)}`);
    }
    if (lastAgent) {
        parts.push(`Last agent reply:\n${clipSideChatText(lastAgent.text, half)}`);
    }
    return clipSideChatText(parts.join('\n\n'), limit);
}

/**
 * The prompt sent to the agent. The preamble is prepended to the first message only, so later turns carry
 * just the user's words. The bubble always shows the user's own text, never the composed prompt.
 */
export function composeSideChatPrompt(message: string, preamble: string | undefined, isFirstUserMessage: boolean): string {
    const text = message.trim();
    return isFirstUserMessage && preamble ? `${preamble}\n\n---\n\n${text}` : text;
}

/**
 * The message as a transcript shows it: a user message loses the side chat background that older builds kept in
 * its text. Other messages, and user text without the marker, come back as the same object.
 */
export function withoutSideChatPreamble<T extends { readonly role: string; readonly content: string }>(message: T): T {
    if (message.role !== 'user' || !message.content.startsWith(QAAP_SIDE_CHAT_PREAMBLE_OPENING)) {
        return message;
    }
    return { ...message, content: stripSideChatPreamble(message.content) };
}
