import type { TranscriptActivityTimelineOptions } from './mobile-projects-transcript-messages-artifacts-ui';
import type { MobileProjectsTranscriptMessagesArtifactsUiContext } from './mobile-projects-transcript-messages-artifacts-ui-context';
// Extracted from mobile-projects-transcript-messages-artifacts-ui.ts

import { type QaapAgentMessageSegmentDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { formatToolActivityLabel } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-list-metrics';
import { resolveTranscriptActivityDiffPeek } from '../common/qaap-transcript-activity-diff-peek';
import { buildTranscriptToolUiPayloadElement } from './qaap-transcript-rich-content-ui';
import {
    resolveTranscriptActivityExpandContent,
    shouldShowTranscriptActivityExpandContent,
    type TranscriptActivityExpandContent,
    type TranscriptActivityExpandDeps,
    type TranscriptActivityTerminalExpandEntry,
} from '../common/qaap-transcript-activity-expand-core';
import { createTranscriptWebSearchCard } from './qaap-transcript-web-search-ui';
import {
    type TranscriptActivityTimelineItem,
} from './mobile-projects-transcript-timeline-utils';

export function syncTranscriptActivityStepCopyCursorTraceExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, rowEl: HTMLElement,
        item: TranscriptActivityTimelineItem,): boolean {
        const verbEl = rowEl.querySelector<HTMLElement>('.theia-mobile-agent-activity-verb');
        const detailEl = rowEl.querySelector<HTMLElement>('.theia-mobile-agent-activity-detail');
        if (!verbEl || !detailEl) {
            return false;
        }
        const hasDiff = item.editAdded !== undefined || item.editRemoved !== undefined;
        const hasTail = !!item.tail;
        const diffEl = rowEl.querySelector('.theia-mobile-agent-activity-diff-stats');
        const tailEl = rowEl.querySelector('.theia-mobile-agent-activity-tail');
        if (hasDiff !== !!diffEl || hasTail !== !!tailEl) {
            return false;
        }
        const verbText = item.verb ?? '';
        const detailAsPill = ctx.shouldRenderTranscriptActivityDetailAsPill(item.detail, item.toolKind);
        if (verbEl.textContent !== verbText) {
            verbEl.textContent = verbText;
        }
        if (detailAsPill) {
            const labelEl = detailEl.querySelector<HTMLElement>('.theia-mobile-agent-activity-detail-label');
            const iconEl = detailEl.querySelector<HTMLElement>('.theia-mobile-agent-activity-file-icon');
            if (!labelEl || !iconEl) {
                return false;
            }
            if (labelEl.textContent !== item.detail) {
                labelEl.textContent = item.detail ?? '';
            }
            const iconClass = `theia-mobile-agent-activity-file-icon codicon ${ctx.transcriptFileIconClass(item.detail ?? '')}`;
            if (iconEl.className !== iconClass) {
                iconEl.className = iconClass;
            }
        } else {
            const detailText = item.detail ? item.detail : '';
            if (detailEl.textContent !== detailText) {
                detailEl.textContent = detailText;
            }
        }
        detailEl.classList.toggle('theia-mod-pill', detailAsPill);
        detailEl.classList.toggle('theia-mod-command', item.toolKind === 'terminal' && !detailAsPill);
        detailEl.classList.toggle('theia-mod-edit-file', item.toolKind === 'editing' && detailAsPill);
        if (hasDiff && diffEl instanceof HTMLElement) {
            const addEl = diffEl.querySelector('.theia-mobile-agent-activity-diff-add');
            const remEl = diffEl.querySelector('.theia-mobile-agent-activity-diff-remove');
            const added = item.editAdded ?? 0;
            const removed = item.editRemoved ?? 0;
            if (added > 0) {
                if (addEl) {
                    addEl.textContent = `+${added}`;
                }
            } else {
                addEl?.remove();
            }
            if (removed > 0) {
                if (remEl) {
                    remEl.textContent = `−${removed}`;
                }
            } else {
                remEl?.remove();
            }
        }
        if (hasTail && tailEl instanceof HTMLElement && item.tail) {
            const tailText = ` ${item.tail}`;
            if (tailEl.textContent !== tailText) {
                tailEl.textContent = tailText;
            }
        }
        ctx.ensureTranscriptActivityVerbDetailSpacing(rowEl);
        if (item.filePath) {
            detailEl.title = item.filePath;
        } else {
            detailEl.removeAttribute('title');
        }
        return true;
}

export function syncTranscriptActivityDiffPeekExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): void {
        const peek = resolveTranscriptActivityDiffPeek(item, options?.segments, 3);
        let peekEl = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-diff-peek');
        if (!peek || !options?.cursorTrace) {
            peekEl?.remove();
            return;
        }
        if (!peekEl) {
            peekEl = document.createElement('div');
            peekEl.className = 'theia-mobile-agent-activity-diff-peek';
            peekEl.setAttribute('aria-hidden', 'true');
            (copy.querySelector('.theia-mobile-agent-activity-meta')
                ?? copy.querySelector('.theia-mobile-agent-activity-row')
                ?? copy.firstElementChild)?.after(peekEl);
        }
        peekEl.replaceChildren();
        for (const line of peek.lines) {
            const lineEl = document.createElement('div');
            lineEl.className = `theia-mobile-agent-activity-diff-peek-line theia-mod-${line.kind}`;
            lineEl.textContent = line.text;
            peekEl.append(lineEl);
        }
}

export function ensureTranscriptActivityVerbDetailSpacingExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, rowEl: HTMLElement): void {
        const verbEl = rowEl.querySelector('.theia-mobile-agent-activity-verb');
        const detailEl = rowEl.querySelector('.theia-mobile-agent-activity-detail');
        if (!verbEl || !detailEl) {
            return;
        }
        if (verbEl.nextSibling === detailEl) {
            verbEl.after(document.createTextNode(' '));
            return;
        }
        let cursor: ChildNode | null = verbEl.nextSibling;
        while (cursor && cursor !== detailEl) {
            if (cursor.nodeType === Node.TEXT_NODE && /\s/.test(cursor.textContent ?? '')) {
                return;
            }
            cursor = cursor.nextSibling;
        }
        verbEl.after(document.createTextNode(' '));
}

export function appendTranscriptActivityEditDiffTailExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, rowEl: HTMLElement,
        added: number,
        removed: number,): void {
        if (added <= 0 && removed <= 0) {
            return;
        }
        const wrap = document.createElement('span');
        wrap.className = 'theia-mobile-agent-activity-diff-stats';
        if (added > 0) {
            const add = document.createElement('span');
            add.className = 'theia-mobile-agent-activity-diff-add';
            add.textContent = `+${added}`;
            wrap.append(add);
        }
        if (removed > 0) {
            const rem = document.createElement('span');
            rem.className = 'theia-mobile-agent-activity-diff-remove';
            rem.textContent = `−${removed}`;
            wrap.append(rem);
        }
        rowEl.append(wrap);
}

export function resolveTranscriptActivityExpandDepsExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext): TranscriptActivityExpandDeps {
        return {
            extractToolPath: args => ctx.resolversUi.extractTranscriptToolPath(args),
            extractToolCommand: args => ctx.resolversUi.extractTranscriptToolCommand(args),
            formatToolLabel: (toolName, args) => formatToolActivityLabel(toolName, args),
        };
}

export function resolveTranscriptActivityExpandContentExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): TranscriptActivityExpandContent | undefined {
        const content = resolveTranscriptActivityExpandContent(item, options?.segments, ctx.resolveTranscriptActivityExpandDeps());
        if (!content) {
            return undefined;
        }
        return ctx.enrichTranscriptActivityExpandContent(content, item, options);
}

export function enrichTranscriptActivityExpandContentExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, content: TranscriptActivityExpandContent,
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): TranscriptActivityExpandContent {
        if (content.kind === 'text' || content.kind === 'todo' || content.kind === 'search-matches'
            || content.kind === 'web-search' || content.kind === 'question_flow') {
            return content;
        }
        if (content.kind === 'read') {
            const segment = item.segmentIndex !== undefined ? options?.segments?.[item.segmentIndex] : undefined;
            return {
                kind: 'read',
                entry: ctx.enrichTranscriptActivityReadExpandEntry(content.entry, segment),
            };
        }
        if (content.kind === 'read-group') {
            return {
                kind: 'read-group',
                entries: content.entries.map((entry, index) => {
                    const segmentIndex = item.segmentIndices?.[index];
                    const segment = segmentIndex !== undefined ? options?.segments?.[segmentIndex] : undefined;
                    return ctx.enrichTranscriptActivityReadExpandEntry(entry, segment);
                }),
            };
        }
        if (content.kind === 'edit') {
            const segment = item.segmentIndex !== undefined ? options?.segments?.[item.segmentIndex] : undefined;
            return {
                kind: 'edit',
                entry: ctx.enrichTranscriptActivityEditExpandEntry(content.entry, segment, options),
            };
        }
        if (content.kind === 'edit-group') {
            return {
                kind: 'edit-group',
                entries: content.entries.map((entry, index) => {
                    const segmentIndex = item.segmentIndices?.[index];
                    const segment = segmentIndex !== undefined ? options?.segments?.[segmentIndex] : undefined;
                    return ctx.enrichTranscriptActivityEditExpandEntry(entry, segment, options);
                }),
            };
        }
        const enrich = (
            entry: TranscriptActivityTerminalExpandEntry,
            segment?: QaapAgentMessageSegmentDTO,
        ): TranscriptActivityTerminalExpandEntry => {
            const rawOutput = segment?.type === 'tool' ? segment.result : entry.output;
            const failed = ctx.resolversUi.transcriptToolResultFailed(rawOutput, segment?.type === 'tool' ? segment.name : undefined);
            const finished = entry.finished ?? (segment?.type === 'tool' ? segment.finished : true);
            const output = rawOutput?.trim() && !/^ok$/i.test(rawOutput.trim())
                ? ctx.resolversUi.formatTranscriptToolResult(rawOutput)
                : undefined;
            const exitCode = finished
                ? (ctx.toolUi.parseTranscriptShellExitCode(rawOutput) ?? (failed ? 1 : undefined))
                : undefined;
            return {
                command: entry.command,
                output,
                failed,
                finished,
                exitCode,
            };
        };
        if (content.kind === 'terminal') {
            const segment = item.segmentIndex !== undefined ? options?.segments?.[item.segmentIndex] : undefined;
            return {
                kind: 'terminal',
                entry: enrich(content.entry, segment),
            };
        }
        return {
            kind: 'terminal-group',
            entries: content.entries.map((entry, index) => {
                const segmentIndex = item.segmentIndices?.[index];
                const segment = segmentIndex !== undefined ? options?.segments?.[segmentIndex] : undefined;
                return enrich(entry, segment);
            }),
        };
}

export function enrichTranscriptActivityReadExpandEntryExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, entry: import('../common/qaap-transcript-activity-expand-core').TranscriptActivityReadExpandEntry,
        segment?: QaapAgentMessageSegmentDTO,): import('../common/qaap-transcript-activity-expand-core').TranscriptActivityReadExpandEntry {
        const raw = segment?.type === 'tool' ? segment.result : entry.text;
        const text = raw?.trim() && !/^ok$/i.test(raw.trim())
            ? ctx.resolversUi.formatTranscriptToolResult(raw)
            : entry.text;
        return {
            path: entry.path ?? (segment?.type === 'tool' ? ctx.resolversUi.extractTranscriptToolPath(segment.args) : undefined),
            text,
        };
}

export function enrichTranscriptActivityEditExpandEntryExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, entry: import('../common/qaap-transcript-activity-expand-core').TranscriptActivityEditExpandEntry,
        segment?: QaapAgentMessageSegmentDTO,
        options?: TranscriptActivityTimelineOptions,): import('../common/qaap-transcript-activity-expand-core').TranscriptActivityEditExpandEntry {
        const stats = options?.segments
            ? ctx.resolversUi.resolveTranscriptFileDiffStats([...options.segments], entry.path)
            : {};
        return {
            path: entry.path,
            added: stats.added ?? entry.added,
            removed: stats.removed ?? entry.removed,
        };
}

export function shouldShowTranscriptActivityItemExpandExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): boolean {
        const content = ctx.resolveTranscriptActivityExpandContent(item, options);
        return shouldShowTranscriptActivityExpandContent(item, content);
}

export function unwrapTranscriptActivityExpandCopyExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, copy: HTMLElement): void {
        const details = copy.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-expand');
        if (!details) {
            return;
        }
        const summary = details.querySelector('summary');
        if (summary) {
            summary.querySelector('.theia-mobile-agent-activity-expand-chevron')?.remove();
            for (const child of [...summary.childNodes]) {
                copy.insertBefore(child, details);
            }
        }
        details.remove();
}

export function syncTranscriptActivityExpandCopyExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, copy: HTMLElement, content: TranscriptActivityExpandContent): void {
        let details = copy.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-expand');
        if (!details) {
            const created = document.createElement('details');
            created.className = 'theia-mobile-agent-activity-expand';
            const summary = document.createElement('summary');
            summary.className = 'theia-mobile-agent-activity-expand-summary';
            const chevron = document.createElement('span');
            chevron.className = 'theia-mobile-agent-activity-expand-chevron codicon codicon-chevron-right';
            chevron.setAttribute('aria-hidden', 'true');
            const movable = [...copy.children].filter(child => {
                if (!(child instanceof HTMLElement)) {
                    return true;
                }
                return !child.classList.contains('theia-mobile-agent-activity-error-detail')
                    && !child.classList.contains('theia-mobile-agent-activity-error-expand');
            });
            summary.append(...movable, chevron);
            const body = document.createElement('div');
            body.className = 'theia-mobile-agent-activity-expand-body';
            created.append(summary, body);
            copy.prepend(created);
            summary.addEventListener('click', event => event.stopPropagation());
            if (!created.dataset.expandToggleBound) {
                created.dataset.expandToggleBound = '1';
                created.addEventListener('toggle', () => {
                    if (created.open) {
                        created.dataset.expandUserExpanded = '1';
                    } else {
                        created.removeAttribute('data-expand-user-expanded');
                        ctx.guardTranscriptActivityExpandClose(copy);
                    }
                });
            }
            details = created;
        }
        const bodyEl = details.querySelector<HTMLElement>('.theia-mobile-agent-activity-expand-body');
        if (bodyEl) {
            ctx.renderTranscriptActivityExpandBody(bodyEl, content);
        }
        if (!details.dataset.expandUserExpanded) {
            details.open = false;
        }
}

export function renderTranscriptActivityExpandBodyExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, body: HTMLElement, content: TranscriptActivityExpandContent): void {
        body.replaceChildren();
        body.className = `theia-mobile-agent-activity-expand-body theia-mod-${content.kind}`;
        if (content.kind === 'text') {
            body.textContent = content.text;
            return;
        }
        if (content.kind === 'search-matches') {
            body.append(ctx.toolUi.createTranscriptActivitySearchMatchesPanel(content.matches));
            return;
        }
        if (content.kind === 'web-search') {
            body.append(createTranscriptWebSearchCard(content.payload, { open: true }));
            return;
        }
        if (content.kind === 'read') {
            body.append(ctx.toolUi.createTranscriptActivityReadExpandPanel([content.entry], { single: true }));
            return;
        }
        if (content.kind === 'read-group') {
            body.append(ctx.toolUi.createTranscriptActivityReadExpandPanel(content.entries));
            return;
        }
        if (content.kind === 'edit') {
            body.append(ctx.toolUi.createTranscriptActivityEditExpandPanel([content.entry], { single: true }));
            return;
        }
        if (content.kind === 'edit-group') {
            body.append(ctx.toolUi.createTranscriptActivityEditExpandPanel(content.entries));
            return;
        }
        if (content.kind === 'terminal') {
            body.append(ctx.toolUi.createTranscriptActivityTerminalExpandPanel([content.entry], { single: true }));
            return;
        }
        if (content.kind === 'todo') {
            body.append(ctx.toolUi.createTranscriptActivityTodoExpandPanel(content.items));
            return;
        }
        if (content.kind === 'question_flow') {
            body.append(buildTranscriptToolUiPayloadElement(content.payload));
            return;
        }
        body.append(ctx.toolUi.createTranscriptActivityTerminalExpandPanel(content.entries));
}

