// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapUsageParsing } from '../usage/qaap-usage-parsing';
import {
    QaapExternalSessionHeader,
    QaapExternalSessionText,
    QaapExternalSessionTranscript,
    QaapExternalTranscriptBuilder
} from './qaap-external-session-transcript';

/** A session row of OpenCode's `opencode.db` (SQLite), already read by the caller. */
export interface QaapExternalOpenCodeSessionRow {
    readonly id: string;
    readonly directory: string;
    readonly title: string;
    readonly timeCreated: number;
    readonly timeUpdated: number;
    readonly parentId?: string;
}

/** A message row; `data` is its JSON payload. */
export interface QaapExternalOpenCodeMessageRow {
    readonly id: string;
    readonly timeCreated: number;
    readonly data: string;
}

/** A part row of a message; `data` is its JSON payload. */
export interface QaapExternalOpenCodePartRow {
    readonly id: string;
    readonly messageId: string;
    readonly timeCreated: number;
    readonly data: string;
}

/** Reads OpenCode sessions from its SQLite store; the caller passes the rows. */
export namespace QaapExternalOpenCodeSessionParser {

    /** OpenCode's placeholder title for a session nobody named. */
    const PLACEHOLDER_TITLE = /^New session - \d{4}-/;

    interface ParsedPart {
        readonly id: string;
        readonly at: number;
        readonly data: Record<string, unknown>;
    }

    export function header(session: QaapExternalOpenCodeSessionRow, firstUserText: string): QaapExternalSessionHeader {
        const rawTitle = typeof session.title === 'string' ? session.title.trim() : '';
        return {
            sessionId: session.id,
            cwd: session.directory,
            title: PLACEHOLDER_TITLE.test(rawTitle) ? '' : rawTitle,
            firstUserMessage: QaapExternalSessionText.preview(firstUserText),
            startedAt: session.timeCreated,
            updatedAt: Math.max(session.timeUpdated, session.timeCreated),
            startedByQaap: QaapExternalSessionText.isStartedByQaap(firstUserText),
        };
    }

    export function parse(
        session: QaapExternalOpenCodeSessionRow,
        messages: readonly QaapExternalOpenCodeMessageRow[],
        parts: readonly QaapExternalOpenCodePartRow[]
    ): QaapExternalSessionTranscript {
        const partsByMessage = groupParts(parts);
        const builder = new QaapExternalTranscriptBuilder();
        let firstUserText: string | undefined;
        const ordered = [...messages].sort((a, b) => a.timeCreated - b.timeCreated || compareIds(a.id, b.id));
        for (const row of ordered) {
            const message = QaapUsageParsing.parseObject(row.data);
            if (!message) {
                continue;
            }
            const rowParts = partsByMessage.get(row.id) ?? [];
            if (message.role === 'user') {
                const text = rowParts.flatMap(part => textOfPart(part)).join('\n');
                if (text.trim()) {
                    firstUserText ??= text;
                    builder.addUser(text, row.timeCreated);
                }
            } else if (message.role === 'assistant') {
                for (const part of rowParts) {
                    addAssistantPart(part, builder);
                }
            }
        }
        return { header: header(session, firstUserText ?? ''), messages: builder.build() };
    }

    function groupParts(parts: readonly QaapExternalOpenCodePartRow[]): Map<string, ParsedPart[]> {
        const grouped = new Map<string, ParsedPart[]>();
        const ordered = [...parts].sort((a, b) => compareIds(a.id, b.id));
        for (const part of ordered) {
            const data = QaapUsageParsing.parseObject(part.data);
            if (!data) {
                continue;
            }
            const list = grouped.get(part.messageId) ?? [];
            list.push({ id: part.id, at: part.timeCreated, data });
            grouped.set(part.messageId, list);
        }
        return grouped;
    }

    /** Text of a visible text part (synthetic parts are injected by OpenCode, not typed by the user). */
    function textOfPart(part: ParsedPart): string[] {
        return part.data.type === 'text' && part.data.synthetic !== true && typeof part.data.text === 'string' ? [part.data.text] : [];
    }

    function addAssistantPart(part: ParsedPart, builder: QaapExternalTranscriptBuilder): void {
        const { data, at } = part;
        switch (data.type) {
            case 'text':
                if (data.synthetic !== true && typeof data.text === 'string') {
                    builder.addAssistantText(data.text, at);
                }
                break;
            case 'reasoning':
                if (typeof data.text === 'string') {
                    builder.addThought(data.text, at);
                }
                break;
            case 'tool': {
                const state = QaapUsageParsing.objectOf(data.state);
                if (!state) {
                    break;
                }
                const callId = nonEmpty(data.callID);
                builder.startTool(callId, nonEmpty(data.tool) ?? '', state.input, at);
                if (state.status === 'completed' || state.status === 'error') {
                    builder.finishTool(callId, textValue(state.output ?? state.error), state.status === 'error', at);
                }
                break;
            }
        }
    }

    /** Tool output is usually a string; anything else is shown as JSON. */
    function textValue(value: unknown): string {
        if (typeof value === 'string') {
            return value;
        }
        if (value === undefined || value === null) {
            return '';
        }
        try {
            return JSON.stringify(value);
        } catch {
            return '';
        }
    }

    function compareIds(a: string, b: string): number {
        return a < b ? -1 : a > b ? 1 : 0;
    }

    function nonEmpty(value: unknown): string | undefined {
        return typeof value === 'string' && value.length > 0 ? value : undefined;
    }
}
