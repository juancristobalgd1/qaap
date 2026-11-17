// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { codicon } from '@theia/core/lib/browser';
import { nls } from '@theia/core/lib/common/nls';
import * as React from '@theia/core/shared/react';
import type {
    QaapGitChangedFile,
    QaapGitFileDiffResponse,
    QaapGitHunkLine,
} from '@theia/qaap-shared-core/lib/common/qaap-git-review';
import {
    highlightTranscriptCodeInto,
    resolveTranscriptCodeLanguage,
    type TranscriptCodeLanguage,
} from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-code-view';
import { countAddedCheckSuppressions, detectCheckSuppression } from '../common/qaap-check-suppression';
import { QaapChangedFileStatus } from './qaap-diff-review-file-status';
import { splitRepoRelativePath } from './qaap-diff-review-path';
import {
    buildContextSegments,
    buildSplitDiffRows,
    diffLineKey,
    splitDiffRowKey,
    type QaapSplitDiffRow,
} from './qaap-diff-review-segments';

/** Unified (one column) or side-by-side (old | new) rendering of the file diffs. */
export type QaapDiffViewMode = 'unified' | 'split';

/**
 * Props of one Agent Changes accordion section. Every value is either a primitive or an object whose
 * identity only changes when that file's data changes, and every handler is a stable widget method
 * that takes the path, so {@link QaapAgentFileSection} skips re-rendering untouched files.
 */
export interface QaapAgentFileSectionProps {
    file: QaapGitChangedFile;
    diff: QaapGitFileDiffResponse | undefined;
    expanded: boolean;
    loading: boolean;
    /** Raw failure detail (HTTP status and server message); shown as a title, never as the main text. */
    errorDetail: string | undefined;
    /** The file changed again after the task (409): the fallback asks for a refresh. */
    errorStale?: boolean;
    viewMode: QaapDiffViewMode;
    /** Soft-wrap long lines; off keeps each line on one row with horizontal scroll. */
    wrapLines: boolean;
    fileActionsEnabled: boolean;
    fileActionRunning: boolean;
    /** Expanded context bars of this file, keyed `${hunkIndex}:${segmentIndex}`; replaced on change. */
    expandedContextBlocks: ReadonlySet<string> | undefined;
    onToggleFile: (path: string) => void;
    onDiscardFile: (path: string) => void;
    onStageFile: (path: string) => void;
    onRetryDiff: (path: string) => void;
    /** Undefined when hunk actions are unavailable (read-only workspace). */
    onStageHunk: ((path: string, hunkIndex: number) => void) | undefined;
    onToggleContextBlock: (path: string, blockKey: string) => void;
}

export const QaapAgentFileSection = React.memo(function QaapAgentFileSection(props: QaapAgentFileSectionProps): React.ReactElement {
    const { file, diff, expanded, onToggleFile, onDiscardFile, onStageFile } = props;
    const path = file.path;
    const isNew = file.status === 'U' || file.status === '?' || file.status === 'A';
    const status = QaapChangedFileStatus.describe(file.status);
    const { base, dir } = splitRepoRelativePath(path);
    const hunksId = `qaap-agent-changes-hunks-${encodeURIComponent(path)}`;
    const onToggle = React.useCallback(() => onToggleFile(path), [onToggleFile, path]);
    const onDiscard = React.useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        onDiscardFile(path);
    }, [onDiscardFile, path]);
    const onStage = React.useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        onStageFile(path);
    }, [onStageFile, path]);
    const suppressionCount = React.useMemo(
        () => diff && !diff.binary ? countAddedCheckSuppressions(diff.hunks, path) : 0,
        [diff, path],
    );
    const fileClass = [
        'qaap-agent-changes-file',
        isNew ? 'qaap-agent-changes-file--new' : '',
        expanded ? '' : 'qaap-agent-changes-file--collapsed',
        suppressionCount > 0 ? 'qaap-agent-changes-file--suppression' : '',
    ].filter(Boolean).join(' ');
    const fullTitle = file.oldPath && file.oldPath !== path ? `${file.oldPath} → ${path}` : path;
    const newFileWithoutLines = isNew && file.adds === 0 && file.dels === 0;
    const rowLabel = newFileWithoutLines
        ? nls.localizeByDefault('{0}: {1}', status.label, fullTitle)
        : nls.localize('qaap/diff/fileRowLabel', '{0}: {1}, {2} added, {3} removed', status.label, fullTitle, String(file.adds), String(file.dels));
    return (
        <section className={fileClass} data-qaap-review-path={path}>
            <div className='qaap-agent-changes-filehdr'>
                <button
                    type='button'
                    className='qaap-agent-changes-filehdr-toggle'
                    title={fullTitle}
                    aria-label={rowLabel}
                    aria-expanded={expanded}
                    aria-controls={hunksId}
                    onClick={onToggle}
                >
                    <i
                        className={`${codicon('chevron-right')} qaap-agent-changes-filehdr-chevron`}
                        aria-hidden='true'
                    />
                    <span className={`qaap-agent-changes-status qaap-mod-${status.kind}`} aria-hidden='true'>{status.letter}</span>
                    {/* Truncates from the left (CSS): the file name stays visible however narrow the panel. */}
                    <span className='qaap-agent-changes-path'>
                        <bdi className='qaap-agent-changes-path-text'>
                            {dir && <span className='qaap-agent-changes-path-dir'>{dir}/</span>}
                            <span className='qaap-agent-changes-path-base'>{base}</span>
                        </bdi>
                    </span>
                    {suppressionCount > 0 && (
                        <span
                            className='qaap-agent-changes-suppression-badge'
                            title={suppressionCount === 1
                                ? nls.localize('qaap/diff/suppressionFileTitleOne', '1 added line silences a lint, type or test check. Review it before accepting.')
                                : nls.localize(
                                    'qaap/diff/suppressionFileTitle',
                                    '{0} added lines silence a lint, type or test check. Review them before accepting.',
                                    String(suppressionCount),
                                )}
                        >
                            <i className={codicon('warning')} aria-hidden='true' />
                            <span className='qaap-agent-changes-suppression-text'>{nls.localize('qaap/diff/suppressesCheck', 'Suppresses a check')}</span>
                        </span>
                    )}
                    {newFileWithoutLines ? (
                        <span className='qaap-agent-changes-filehdr-stats'>
                            {nls.localize('qaap/diff/newFileStats', 'New file')}
                        </span>
                    ) : (
                        <span className='qaap-agent-changes-filehdr-stats'>
                            <span className='qaap-diff-add'>+{file.adds}</span>
                            <span className='qaap-diff-del'>−{file.dels}</span>
                        </span>
                    )}
                </button>
                {props.fileActionsEnabled && (
                    <span className='qaap-agent-changes-filehdr-actions'>
                        <button
                            type='button'
                            className='qaap-diff-review-icon-btn'
                            title={nls.localize('qaap/diff/discardFile', 'Discard file changes')}
                            aria-label={nls.localize('qaap/diff/discardFile', 'Discard file changes')}
                            disabled={props.fileActionRunning}
                            onClick={onDiscard}
                        >
                            <i className={codicon('discard')} aria-hidden='true' />
                        </button>
                        <button
                            type='button'
                            className='qaap-diff-review-icon-btn'
                            title={nls.localize('qaap/diff/stageFile', 'Stage file')}
                            aria-label={nls.localize('qaap/diff/stageFile', 'Stage file')}
                            disabled={props.fileActionRunning}
                            onClick={onStage}
                        >
                            <i className={codicon('add')} aria-hidden='true' />
                        </button>
                    </span>
                )}
            </div>
            {/* Collapsed files keep only the empty container (for aria-controls); their hunks are not rendered. */}
            <div
                id={hunksId}
                className={`qaap-agent-changes-hunks qaap-mod-${props.viewMode}${props.wrapLines ? '' : ' qaap-mod-nowrap'}`}
                hidden={!expanded}
            >
                {expanded && (diff ? <AgentFileDiff {...props} diff={diff} /> : <AgentFileDiffFallback {...props} />)}
            </div>
        </section>
    );
});

function AgentFileDiff(props: QaapAgentFileSectionProps & { diff: QaapGitFileDiffResponse }): React.ReactElement {
    const { diff, file } = props;
    const language = React.useMemo(() => resolveTranscriptCodeLanguage(file.path), [file.path]);
    if (diff.binary) {
        return <div className='qaap-diff-review-note'>{nls.localize('qaap/diff/binary', 'Binary file — open in the editor to inspect.')}</div>;
    }
    if (diff.hunks.length === 0) {
        return <div className='qaap-diff-review-note'>{nls.localize('qaap/diff/noHunks', 'No textual changes.')}</div>;
    }
    return (
        <>
            {diff.hunks.map((hunk, hunkIndex) => (
                <AgentHunk
                    key={hunkIndex}
                    path={file.path}
                    hunkIndex={hunkIndex}
                    lines={hunk.lines}
                    language={language}
                    viewMode={props.viewMode}
                    expandedContextBlocks={props.expandedContextBlocks}
                    onStageHunk={props.onStageHunk}
                    onToggleContextBlock={props.onToggleContextBlock}
                />
            ))}
        </>
    );
}

/** Loading note, or the recorded per-file failure with its server detail and a retry action. */
function AgentFileDiffFallback(props: QaapAgentFileSectionProps): React.ReactElement {
    const { onRetryDiff, file } = props;
    const onRetry = React.useCallback(() => onRetryDiff(file.path), [onRetryDiff, file.path]);
    if (props.loading) {
        // One loading cue per file (no separate list-wide skeleton); the text is for screen readers.
        return (
            <div className='qaap-agent-changes-loading' aria-busy='true'>
                <span className='qaap-agent-changes-loading-label'>{nls.localize('qaap/diff/loading', 'Loading diff…')}</span>
                <div className='qaap-agent-changes-loading-bar' />
                <div className='qaap-agent-changes-loading-bar qaap-mod-short' />
            </div>
        );
    }
    const message = props.errorStale
        ? nls.localize(
            'qaap/diff/loadFailedStale',
            'This file changed again since the task finished. Refresh to see the current diff.',
        )
        : nls.localize('qaap/diff/loadFailed', 'Could not load the diff for this file.');
    return (
        <div
            className='qaap-diff-review-note qaap-mod-compact qaap-mod-load-failed'
            title={props.errorDetail || undefined}
        >
            <span>{message}</span>
            <button type='button' className='qaap-diff-review-inline-btn' onClick={onRetry}>
                {nls.localize('qaap/diff/retry', 'Retry')}
            </button>
        </div>
    );
}

interface AgentHunkProps {
    path: string;
    hunkIndex: number;
    lines: QaapGitHunkLine[];
    language: TranscriptCodeLanguage;
    viewMode: QaapDiffViewMode;
    expandedContextBlocks: ReadonlySet<string> | undefined;
    onStageHunk: ((path: string, hunkIndex: number) => void) | undefined;
    onToggleContextBlock: (path: string, blockKey: string) => void;
}

const AgentHunk = React.memo(function AgentHunk(props: AgentHunkProps): React.ReactElement {
    const { path, hunkIndex, lines, language, viewMode, expandedContextBlocks, onStageHunk, onToggleContextBlock } = props;
    const onStageLine = React.useMemo(
        () => onStageHunk ? (): void => onStageHunk(path, hunkIndex) : undefined,
        [onStageHunk, path, hunkIndex],
    );
    const onToggleBlock = React.useCallback(
        (blockKey: string) => onToggleContextBlock(path, blockKey),
        [onToggleContextBlock, path],
    );
    const renderLines = (segmentLines: QaapGitHunkLine[], offset: number): React.ReactNode => viewMode === 'split'
        ? buildSplitDiffRows(segmentLines).map((row, rowIndex) => (
            <QaapSplitDiffLine
                key={splitDiffRowKey(row, offset + rowIndex)}
                row={row}
                path={path}
                language={language}
                onStageLine={onStageLine}
            />
        ))
        : segmentLines.map((line, lineIndex) => (
            <QaapDiffLine
                key={diffLineKey(line, offset + lineIndex)}
                line={line}
                path={path}
                agentStyle={true}
                language={language}
                onStageLine={onStageLine}
            />
        ));
    // Consecutive visible segments render as one run, so the split view can pair a removed line with
    // the added line that replaces it (each changed line is its own segment).
    const groups: Array<{ kind: 'lines'; lines: QaapGitHunkLine[]; offset: number; key: string }
        | { kind: 'collapsed'; lines: QaapGitHunkLine[]; offset: number; blockKey: string }> = [];
    let offset = 0;
    buildContextSegments(lines).forEach((segment, segmentIndex) => {
        const last = groups[groups.length - 1];
        if (segment.kind === 'lines' && last?.kind === 'lines') {
            last.lines = [...last.lines, ...segment.lines];
        } else if (segment.kind === 'lines') {
            groups.push({ kind: 'lines', lines: segment.lines, offset, key: `lines-${segmentIndex}` });
        } else {
            groups.push({ kind: 'collapsed', lines: segment.lines, offset, blockKey: `${hunkIndex}:${segmentIndex}` });
        }
        offset += segment.lines.length;
    });
    return (
        <div className='qaap-diff-review-hunk qaap-diff-review-hunk--agent'>
            {groups.map(group => {
                if (group.kind === 'lines') {
                    return <React.Fragment key={group.key}>{renderLines(group.lines, group.offset)}</React.Fragment>;
                }
                const expanded = !!expandedContextBlocks?.has(group.blockKey);
                return (
                    <React.Fragment key={`ctx-${group.blockKey}`}>
                        <CollapsedContextBar
                            blockKey={group.blockKey}
                            count={group.lines.length}
                            expanded={expanded}
                            onToggle={onToggleBlock}
                        />
                        {expanded && renderLines(group.lines, group.offset)}
                    </React.Fragment>
                );
            })}
        </div>
    );
});

const CollapsedContextBar = React.memo(function CollapsedContextBar(props: {
    blockKey: string;
    count: number;
    expanded: boolean;
    onToggle: (blockKey: string) => void;
}): React.ReactElement {
    const { blockKey, onToggle } = props;
    const onClick = React.useCallback(() => onToggle(blockKey), [onToggle, blockKey]);
    const label = props.count === 1
        ? nls.localize('qaap/diff/oneUnmodifiedLine', '1 unmodified line')
        : nls.localize('qaap/diff/nUnmodifiedLines', '{0} unmodified lines', String(props.count));
    const icon = props.expanded ? codicon('chevron-up') : codicon('chevron-down');
    return (
        <button
            type='button'
            className={`qaap-diff-review-collapsed${props.expanded ? ' qaap-mod-expanded' : ''}`}
            onClick={onClick}
            aria-expanded={props.expanded}
        >
            <i className={`${icon} qaap-diff-review-collapsed-chevron`} aria-hidden='true' />
            <span>{label}</span>
        </button>
    );
});

function HighlightedDiffCode(props: {
    text: string;
    language: TranscriptCodeLanguage;
}): React.ReactElement {
    const hostRef = React.useRef<HTMLSpanElement>(null);
    React.useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host) {
            return;
        }
        highlightTranscriptCodeInto(host, props.text, props.language);
    }, [props.text, props.language]);
    return <span ref={hostRef} className='qaap-diff-review-code theia-mobile-agent-code-text' />;
}

/** One unified-diff row; memoized so unchanged lines skip re-render and re-highlighting. */
export const QaapDiffLine = React.memo(function QaapDiffLine(props: {
    line: QaapGitHunkLine;
    /** File path, so config-file suppressions (rules turned off in lint/tsconfig) are recognized. */
    path?: string;
    agentStyle?: boolean;
    language?: TranscriptCodeLanguage;
    onStageLine?: () => void;
}): React.ReactElement {
    const { line, path, agentStyle, language, onStageLine } = props;
    const suppression = line.type === 'add' ? detectCheckSuppression(line.text, path) : undefined;
    const onStageClick = React.useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        onStageLine?.();
    }, [onStageLine]);
    const sign = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ';
    const number = line.type === 'del' ? line.oldNumber : line.newNumber;
    const canStage = !!agentStyle && !!onStageLine && (line.type === 'add' || line.type === 'del');
    const lineClass = [
        'qaap-diff-review-line',
        `qaap-diff-review-line--${line.type}`,
        agentStyle ? 'qaap-diff-review-line--agent' : '',
        suppression ? 'qaap-diff-review-line--suppression' : '',
    ].filter(Boolean).join(' ');
    return (
        <div className={lineClass} data-qaap-suppression={suppression}>
            {canStage && (
                <button
                    type='button'
                    className='qaap-agent-changes-line-stage'
                    title={nls.localize('qaap/diff/stageLine', 'Stage this change')}
                    aria-label={nls.localize('qaap/diff/stageLine', 'Stage this change')}
                    onClick={onStageClick}
                >
                    <span aria-hidden='true'>+</span>
                </button>
            )}
            {agentStyle
                ? (
                    // Old and new line numbers side by side (removed lines have no new number, added
                    // lines no old one), so the numbering never seems to jump back after a removal.
                    <>
                        <span className='qaap-diff-review-gutter qaap-mod-old'>{line.type === 'add' ? '' : line.oldNumber ?? ''}</span>
                        <span className='qaap-diff-review-gutter qaap-mod-new'>{line.type === 'del' ? '' : line.newNumber ?? ''}</span>
                    </>
                )
                : <span className='qaap-diff-review-gutter'>{number ?? ''}</span>}
            {!agentStyle && <span className='qaap-diff-review-sign'>{sign}</span>}
            {agentStyle && language
                ? <HighlightedDiffCode text={line.text} language={language} />
                : <span className='qaap-diff-review-code'>{line.text}</span>}
            {suppression && (
                <span
                    className='qaap-diff-review-suppression-marker'
                    title={nls.localize(
                        'qaap/diff/suppressionLineTitle',
                        'This line silences a check instead of fixing it. Accept it only if you asked for it.',
                    )}
                >
                    <i className={codicon('warning')} aria-hidden='true' />
                    {nls.localize('qaap/diff/suppressesCheck', 'Suppresses a check')}
                </span>
            )}
        </div>
    );
});

/** One side-by-side cell: line number and code of one side, or an empty filler cell. */
function SplitDiffCell(props: {
    line: QaapGitHunkLine | undefined;
    side: 'old' | 'new';
    path: string;
    language: TranscriptCodeLanguage;
}): React.ReactElement {
    const { line, side, path, language } = props;
    if (!line) {
        return <div className={`qaap-diff-review-split-cell qaap-mod-${side} qaap-mod-empty`} aria-hidden='true' />;
    }
    const suppression = line.type === 'add' ? detectCheckSuppression(line.text, path) : undefined;
    const number = side === 'old' ? line.oldNumber : line.newNumber;
    const cellClass = [
        'qaap-diff-review-split-cell',
        `qaap-mod-${side}`,
        `qaap-diff-review-line--${line.type}`,
        suppression ? 'qaap-diff-review-line--suppression' : '',
    ].filter(Boolean).join(' ');
    return (
        <div className={cellClass} data-qaap-suppression={suppression}>
            <span className='qaap-diff-review-gutter'>{number ?? ''}</span>
            <HighlightedDiffCode text={line.text} language={language} />
            {suppression && (
                <span
                    className='qaap-diff-review-suppression-marker'
                    title={nls.localize(
                        'qaap/diff/suppressionLineTitle',
                        'This line silences a check instead of fixing it. Accept it only if you asked for it.',
                    )}
                >
                    <i className={codicon('warning')} aria-hidden='true' />
                </span>
            )}
        </div>
    );
}

/** One side-by-side row (old | new); memoized like {@link QaapDiffLine}. */
export const QaapSplitDiffLine = React.memo(function QaapSplitDiffLine(props: {
    row: QaapSplitDiffRow;
    path: string;
    language: TranscriptCodeLanguage;
    onStageLine?: () => void;
}): React.ReactElement {
    const { row, path, language, onStageLine } = props;
    const onStageClick = React.useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        onStageLine?.();
    }, [onStageLine]);
    const changed = row.left?.type === 'del' || row.right?.type === 'add';
    return (
        <div className='qaap-diff-review-line qaap-diff-review-line--agent qaap-diff-review-split-row'>
            {changed && onStageLine && (
                <button
                    type='button'
                    className='qaap-agent-changes-line-stage'
                    title={nls.localize('qaap/diff/stageLine', 'Stage this change')}
                    aria-label={nls.localize('qaap/diff/stageLine', 'Stage this change')}
                    onClick={onStageClick}
                >
                    <span aria-hidden='true'>+</span>
                </button>
            )}
            <SplitDiffCell line={row.left} side='old' path={path} language={language} />
            <SplitDiffCell line={row.right} side='new' path={path} language={language} />
        </div>
    );
});
