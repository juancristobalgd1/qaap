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
import { leadingTruncatePath } from './qaap-diff-review-path';
import { buildContextSegments, diffLineKey } from './qaap-diff-review-segments';

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
    errorDetail: string | undefined;
    iconClass: string;
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
    const isNew = file.status === 'U' || file.status === '?';
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
    const fileClass = [
        'qaap-agent-changes-file',
        isNew ? 'qaap-agent-changes-file--new' : '',
        expanded ? '' : 'qaap-agent-changes-file--collapsed',
    ].filter(Boolean).join(' ');
    return (
        <section className={fileClass} data-qaap-review-path={path}>
            <div className='qaap-agent-changes-filehdr'>
                <button
                    type='button'
                    className='qaap-agent-changes-filehdr-toggle'
                    title={path}
                    aria-expanded={expanded}
                    aria-controls={hunksId}
                    onClick={onToggle}
                >
                    <i
                        className={`${codicon('chevron-right')} qaap-agent-changes-filehdr-chevron`}
                        aria-hidden='true'
                    />
                    <i className={props.iconClass} aria-hidden='true' />
                    <span className='qaap-agent-changes-path'>{leadingTruncatePath(path)}</span>
                    {isNew && (
                        <span className='qaap-agent-changes-new-badge'>
                            {nls.localize('qaap/diff/newFile', 'New')}
                        </span>
                    )}
                    <span className='qaap-agent-changes-filehdr-stats'>
                        <span className='qaap-diff-add'>+{file.adds}</span>
                        <span className='qaap-diff-del'>-{file.dels}</span>
                    </span>
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
                            <i className={codicon('discard')} />
                        </button>
                        <button
                            type='button'
                            className='qaap-diff-review-icon-btn'
                            title={nls.localize('qaap/diff/stageFile', 'Stage file')}
                            aria-label={nls.localize('qaap/diff/stageFile', 'Stage file')}
                            disabled={props.fileActionRunning}
                            onClick={onStage}
                        >
                            <i className={codicon('diff')} />
                        </button>
                    </span>
                )}
            </div>
            {/* Collapsed files keep only the empty container (for aria-controls); their hunks are not rendered. */}
            <div id={hunksId} className='qaap-agent-changes-hunks' hidden={!expanded}>
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
        return (
            <div className='qaap-diff-review-note qaap-mod-compact'>
                {nls.localize('qaap/diff/loading', 'Loading diff…')}
            </div>
        );
    }
    return (
        <div className='qaap-diff-review-note qaap-mod-compact'>
            <span>
                {nls.localize('qaap/diff/loadFailed', 'Could not load diff for this file.')}
                {props.errorDetail ? ` (${props.errorDetail})` : ''}
            </span>
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
    expandedContextBlocks: ReadonlySet<string> | undefined;
    onStageHunk: ((path: string, hunkIndex: number) => void) | undefined;
    onToggleContextBlock: (path: string, blockKey: string) => void;
}

const AgentHunk = React.memo(function AgentHunk(props: AgentHunkProps): React.ReactElement {
    const { path, hunkIndex, lines, language, expandedContextBlocks, onStageHunk, onToggleContextBlock } = props;
    const onStageLine = React.useMemo(
        () => onStageHunk ? (): void => onStageHunk(path, hunkIndex) : undefined,
        [onStageHunk, path, hunkIndex],
    );
    const onToggleBlock = React.useCallback(
        (blockKey: string) => onToggleContextBlock(path, blockKey),
        [onToggleContextBlock, path],
    );
    const renderLines = (segmentLines: QaapGitHunkLine[], offset: number): React.ReactNode => segmentLines.map((line, lineIndex) => (
        <QaapDiffLine
            key={diffLineKey(line, offset + lineIndex)}
            line={line}
            agentStyle={true}
            language={language}
            onStageLine={onStageLine}
        />
    ));
    let offset = 0;
    return (
        <div className='qaap-diff-review-hunk qaap-diff-review-hunk--agent'>
            {buildContextSegments(lines).map((segment, segmentIndex) => {
                const segmentOffset = offset;
                offset += segment.lines.length;
                if (segment.kind === 'lines') {
                    return <React.Fragment key={`lines-${segmentIndex}`}>{renderLines(segment.lines, segmentOffset)}</React.Fragment>;
                }
                const blockKey = `${hunkIndex}:${segmentIndex}`;
                const expanded = !!expandedContextBlocks?.has(blockKey);
                return (
                    <React.Fragment key={`ctx-${segmentIndex}`}>
                        <CollapsedContextBar
                            blockKey={blockKey}
                            count={segment.lines.length}
                            expanded={expanded}
                            onToggle={onToggleBlock}
                        />
                        {expanded && renderLines(segment.lines, segmentOffset)}
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
    agentStyle?: boolean;
    language?: TranscriptCodeLanguage;
    onStageLine?: () => void;
}): React.ReactElement {
    const { line, agentStyle, language, onStageLine } = props;
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
    ].filter(Boolean).join(' ');
    return (
        <div className={lineClass}>
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
            <span className='qaap-diff-review-gutter'>{number ?? ''}</span>
            {!agentStyle && <span className='qaap-diff-review-sign'>{sign}</span>}
            {agentStyle && language
                ? <HighlightedDiffCode text={line.text} language={language} />
                : <span className='qaap-diff-review-code'>{line.text}</span>}
        </div>
    );
});
