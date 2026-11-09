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

/** Reads Codex rollout logs (`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl`), lines of `{ timestamp, type, payload }`. */
export namespace QaapExternalCodexSessionParser {

    /** A shell or exec result that reports a non-zero exit code. */
    const FAILED_OUTPUT = /Process exited with code [1-9]|Exit code: [1-9]/;

    export function parse(lines: readonly string[], options: QaapExternalJsonlParseOptions): QaapExternalSessionTranscript | undefined {
        const builder = options.headerOnly ? undefined : new QaapExternalTranscriptBuilder();
        let sessionId: string | undefined;
        let cwd: string | undefined;
        let originator: string | undefined;
        let title = '';
        let firstUserText: string | undefined;
        let lastUserText: string | undefined;
        let startedAt: number | undefined;
        let updatedAt: number | undefined;
        let lastAt = options.fallbackTimestampMs;

        const addUser = (text: string, at: number): void => {
            if (firstUserText === undefined && text.trim()) {
                firstUserText = text;
            }
            // Codex writes the same user turn twice (`user_message` and `item_completed`) back to back.
            // A repeated prompt after an assistant reply ("continue") is a real new turn, so only a back-to-back copy is dropped.
            if (text === lastUserText) {
                lastUserText = undefined;
                return;
            }
            lastUserText = text;
            builder?.addUser(text, at);
        };

        for (const line of lines) {
            const entry = QaapUsageParsing.parseObject(line);
            if (!entry) {
                continue;
            }
            const own = QaapUsageParsing.timestampMs(entry.timestamp);
            if (own !== undefined) {
                startedAt ??= own;
                updatedAt = Math.max(updatedAt ?? own, own);
                lastAt = own;
            }
            const at = lastAt;
            const payload = QaapUsageParsing.objectOf(entry.payload);
            if (!payload) {
                continue;
            }
            switch (entry.type) {
                case 'session_meta':
                    sessionId ??= nonEmpty(payload.id);
                    cwd ??= nonEmpty(payload.cwd);
                    originator ??= nonEmpty(payload.originator);
                    break;
                case 'event_msg':
                    switch (payload.type) {
                        case 'user_message':
                            addUser(nonEmpty(payload.message) ?? '', at);
                            break;
                        case 'item_completed': {
                            const item = QaapUsageParsing.objectOf(payload.item);
                            if (item?.type === 'UserMessage') {
                                addUser(QaapExternalSessionText.textOf(item.content), at);
                            }
                            break;
                        }
                        case 'thread_name_updated':
                            title = nonEmpty(payload.thread_name) ?? title;
                            break;
                        case 'thread_renamed':
                            title = nonEmpty(payload.name) ?? title;
                            break;
                    }
                    break;
                case 'response_item':
                    if (payload.type !== 'message' || payload.role === 'assistant') {
                        lastUserText = undefined;
                    }
                    addResponseItem(payload, at, builder);
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
            ...(originator ? { originator } : {}),
            startedByQaap: QaapExternalSessionText.isStartedByQaap(firstText),
        };
        return { header, messages: builder?.build() ?? [] };
    }

    /** Assistant output, reasoning and tool items. `user` and `developer` messages hold injected context and are dropped. */
    function addResponseItem(payload: Record<string, unknown>, at: number, builder: QaapExternalTranscriptBuilder | undefined): void {
        switch (payload.type) {
            case 'message':
                if (payload.role === 'assistant') {
                    builder?.addAssistantText(QaapExternalSessionText.textOf(payload.content), at);
                }
                break;
            case 'reasoning':
                builder?.addThought(QaapExternalSessionText.textOf(payload.summary), at);
                break;
            case 'function_call':
                builder?.startTool(nonEmpty(payload.call_id), nonEmpty(payload.name) ?? '', parseArguments(payload.arguments), at);
                break;
            case 'function_call_output':
            case 'custom_tool_call_output':
                finishOutput(payload, at, builder);
                break;
            case 'custom_tool_call':
                builder?.startTool(nonEmpty(payload.call_id), nonEmpty(payload.name) ?? '', payload.input, at);
                break;
            case 'web_search_call':
                builder?.startTool(undefined, 'web_search', { query: QaapUsageParsing.objectOf(payload.action)?.query }, at);
                break;
        }
    }

    function finishOutput(payload: Record<string, unknown>, at: number, builder: QaapExternalTranscriptBuilder | undefined): void {
        const output = outputText(payload.output);
        builder?.finishTool(nonEmpty(payload.call_id), output, FAILED_OUTPUT.test(output), at);
    }

    /** Function arguments are a JSON string; keep the raw string when it does not parse. */
    function parseArguments(value: unknown): unknown {
        if (typeof value !== 'string') {
            return value;
        }
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }

    /** Tool output is a string, or an object whose `content` holds the text. */
    function outputText(value: unknown): string {
        if (typeof value === 'string') {
            return value;
        }
        const content = QaapUsageParsing.objectOf(value)?.content;
        if (typeof content === 'string') {
            return content;
        }
        if (Array.isArray(content)) {
            return QaapExternalSessionText.textOf(content);
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

    function nonEmpty(value: unknown): string | undefined {
        return typeof value === 'string' && value.length > 0 ? value : undefined;
    }
}
