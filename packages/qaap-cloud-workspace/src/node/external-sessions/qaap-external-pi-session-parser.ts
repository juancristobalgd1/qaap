// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapUsageParsing } from '../usage/qaap-usage-parsing';
import type { QaapExternalJsonlParseOptions } from './qaap-external-session-parse-options';
import {
    QaapExternalSessionHeader,
    QaapExternalSessionText,
    QaapExternalSessionTranscript,
    QaapExternalTranscriptBuilder
} from './qaap-external-session-transcript';

/** Reads Pi session logs (`<pi sessions>/--<cwd>--/<ts>_<uuid>.jsonl`): a `session` header line, then entries. */
export namespace QaapExternalPiSessionParser {

    export function parse(lines: readonly string[], options: QaapExternalJsonlParseOptions): QaapExternalSessionTranscript | undefined {
        const builder = options.headerOnly ? undefined : new QaapExternalTranscriptBuilder();
        let sessionId: string | undefined;
        let cwd: string | undefined;
        let title = '';
        let firstUserText: string | undefined;
        let startedAt: number | undefined;
        let updatedAt: number | undefined;
        let lastAt = options.fallbackTimestampMs;
        for (const line of lines) {
            const entry = QaapUsageParsing.parseObject(line);
            if (!entry) {
                continue;
            }
            const message = QaapUsageParsing.objectOf(entry.message);
            const own = QaapUsageParsing.timestampMs(entry.timestamp) ?? QaapUsageParsing.timestampMs(message?.timestamp);
            if (own !== undefined) {
                startedAt ??= own;
                updatedAt = Math.max(updatedAt ?? own, own);
                lastAt = own;
            }
            const at = lastAt;
            switch (entry.type) {
                case 'session':
                    sessionId ??= nonEmpty(entry.id);
                    cwd ??= nonEmpty(entry.cwd);
                    break;
                case 'session_info':
                    title = nonEmpty(entry.name) ?? title;
                    break;
                case 'message':
                    if (message) {
                        firstUserText = addMessage(message, at, builder, firstUserText);
                    }
                    break;
            }
        }
        if (cwd === undefined) {
            return undefined;
        }
        const firstText = firstUserText ?? '';
        const header: QaapExternalSessionHeader = {
            sessionId: sessionId ?? options.fallbackSessionId,
            cwd,
            title: title.trim(),
            firstUserMessage: QaapExternalSessionText.preview(firstText),
            startedAt: startedAt ?? options.fallbackTimestampMs,
            updatedAt: updatedAt ?? options.fallbackTimestampMs,
            startedByQaap: QaapExternalSessionText.isStartedByQaap(firstText),
        };
        return { header, messages: builder?.build() ?? [] };
    }

    /** Folds one `message` entry in; returns the (possibly new) first user text. System messages are dropped. */
    function addMessage(
        message: Record<string, unknown>,
        at: number,
        builder: QaapExternalTranscriptBuilder | undefined,
        firstUserText: string | undefined
    ): string | undefined {
        switch (message.role) {
            case 'user': {
                const text = QaapExternalSessionText.textOf(message.content);
                builder?.addUser(text, at);
                return firstUserText ?? (text.trim() ? text : undefined);
            }
            case 'assistant':
                for (const block of blocksOf(message.content)) {
                    switch (block.type) {
                        case 'text':
                            if (typeof block.text === 'string') {
                                builder?.addAssistantText(block.text, at);
                            }
                            break;
                        case 'thinking':
                            if (typeof block.thinking === 'string') {
                                builder?.addThought(block.thinking, at);
                            }
                            break;
                        case 'toolCall':
                            builder?.startTool(nonEmpty(block.id), nonEmpty(block.name) ?? '', block.arguments, at);
                            break;
                    }
                }
                return firstUserText;
            case 'toolResult':
                builder?.finishTool(nonEmpty(message.toolCallId), QaapExternalSessionText.textOf(message.content), message.isError === true, at);
                return firstUserText;
            default:
                return firstUserText;
        }
    }

    /** Content as blocks: a plain string is one text block. */
    function blocksOf(content: unknown): Record<string, unknown>[] {
        if (typeof content === 'string') {
            return [{ type: 'text', text: content }];
        }
        if (!Array.isArray(content)) {
            return [];
        }
        return content.flatMap(block => {
            const item = QaapUsageParsing.objectOf(block);
            return item ? [item] : [];
        });
    }

    function nonEmpty(value: unknown): string | undefined {
        return typeof value === 'string' && value.length > 0 ? value : undefined;
    }
}
