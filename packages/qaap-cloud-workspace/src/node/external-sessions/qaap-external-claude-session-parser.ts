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

/** Reads Claude Code session logs (`<config>/projects/<slug>/<uuid>.jsonl`), one JSON object per line. */
export namespace QaapExternalClaudeSessionParser {

    /** User text that Claude Code writes for its own bookkeeping (slash commands, reminders, interrupts): not a turn. */
    const INJECTED_PREFIXES = ['<command-name>', '<local-command-', '<command-message>', '<system-reminder>', 'Caveat:', '[Request interrupted'];

    export function parse(lines: readonly string[], options: QaapExternalJsonlParseOptions): QaapExternalSessionTranscript | undefined {
        const builder = options.headerOnly ? undefined : new QaapExternalTranscriptBuilder();
        let cwd: string | undefined;
        let sessionId: string | undefined;
        let customTitle = '';
        let aiTitle = '';
        let summary = '';
        let firstUserText: string | undefined;
        let startedAt: number | undefined;
        let updatedAt: number | undefined;
        let lastAt = options.fallbackTimestampMs;
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
            cwd ??= nonEmpty(entry.cwd);
            sessionId ??= nonEmpty(entry.sessionId);
            switch (entry.type) {
                case 'user':
                    if (entry.isSidechain === true || entry.isMeta === true) {
                        break;
                    }
                    firstUserText = addUserEntry(entry, at, builder, firstUserText);
                    break;
                case 'assistant':
                    if (entry.isSidechain !== true) {
                        addAssistantEntry(entry, at, builder);
                    }
                    break;
                case 'custom-title':
                    customTitle = nonEmpty(entry.customTitle) ?? customTitle;
                    break;
                case 'ai-title':
                    aiTitle = nonEmpty(entry.aiTitle) ?? nonEmpty(entry.title) ?? aiTitle;
                    break;
                case 'summary':
                    summary = nonEmpty(entry.summary) ?? summary;
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
            title: (customTitle || aiTitle || summary).trim(),
            firstUserMessage: QaapExternalSessionText.preview(firstText),
            startedAt: startedAt ?? options.fallbackTimestampMs,
            updatedAt: updatedAt ?? options.fallbackTimestampMs,
            startedByQaap: QaapExternalSessionText.isStartedByQaap(firstText),
        };
        return { header, messages: builder?.build() ?? [] };
    }

    /** Records the tool results and the real user text of one user entry; returns the (possibly new) first user text. */
    function addUserEntry(
        entry: Record<string, unknown>,
        at: number,
        builder: QaapExternalTranscriptBuilder | undefined,
        firstUserText: string | undefined
    ): string | undefined {
        const content = QaapUsageParsing.objectOf(entry.message)?.content;
        for (const block of Array.isArray(content) ? content : []) {
            const item = QaapUsageParsing.objectOf(block);
            if (item?.type === 'tool_result' && typeof item.tool_use_id === 'string') {
                builder?.finishTool(item.tool_use_id, QaapExternalSessionText.textOf(item.content), item.is_error === true, at);
            }
        }
        const text = QaapExternalSessionText.textOf(content);
        if (!text.trim() || isInjected(text)) {
            return firstUserText;
        }
        builder?.addUser(text, at);
        return firstUserText ?? text;
    }

    function addAssistantEntry(entry: Record<string, unknown>, at: number, builder: QaapExternalTranscriptBuilder | undefined): void {
        const content = QaapUsageParsing.objectOf(entry.message)?.content;
        for (const block of Array.isArray(content) ? content : []) {
            const item = QaapUsageParsing.objectOf(block);
            if (!item) {
                continue;
            }
            switch (item.type) {
                case 'text':
                    if (typeof item.text === 'string') {
                        builder?.addAssistantText(item.text, at);
                    }
                    break;
                case 'thinking':
                    if (typeof item.thinking === 'string') {
                        builder?.addThought(item.thinking, at);
                    }
                    break;
                case 'tool_use':
                    builder?.startTool(nonEmpty(item.id), nonEmpty(item.name) ?? '', item.input, at);
                    break;
            }
        }
    }

    function isInjected(text: string): boolean {
        const trimmed = text.trim();
        return INJECTED_PREFIXES.some(prefix => trimmed.startsWith(prefix));
    }

    function nonEmpty(value: unknown): string | undefined {
        return typeof value === 'string' && value.length > 0 ? value : undefined;
    }
}
