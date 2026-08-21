// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { nls } from '@theia/core/lib/common/nls';
import { Disposable } from '@theia/core/lib/common/disposable';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { LabelProvider, URIIconReference } from '@theia/core/lib/browser';
import { ColorRegistry } from '@theia/core/lib/browser/color-registry';
import { DecorationsService } from '@theia/core/lib/browser/decorations-service';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoEditorProvider } from '@theia/monaco/lib/browser/monaco-editor-provider';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { MarkdownPreviewHandler } from '@theia/preview/lib/browser/markdown/markdown-preview-handler';
import type { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import type { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import type { ScmService } from '@theia/scm/lib/browser/scm-service';
import { isTranscriptWorkspaceFilesystemPath } from '../common/qaap-transcript-workspace-cwd';
import { resolveWorkspaceHostFsPath } from './qaap-project-bootstrap-shell';
import {
    type TranscriptFileDecoration,
    type TranscriptFileTreeEntry,
    type TranscriptFilesViewServices,
} from './qaap-transcript-files-view';
import { createTranscriptPreviewMonacoEditor } from './qaap-transcript-monaco-editor';

// Keep this stable Theia widget id local: importing scm-contribution solely for the constant
// eagerly pulls Monaco's ESM editor bundle into lightweight transcript and Node test paths.
const QAAP_SCM_VIEW_CONTAINER_ID = 'scm-view-container';

export async function openTranscriptWorkspaceFile(
    filePath: string,
    workspaceService: WorkspaceService,
    editorManager: EditorManager,
): Promise<void> {
    const trimmed = filePath.trim();
    if (!trimmed) {
        return;
    }
    const uri = resolveTranscriptWorkspaceFileUri(trimmed, workspaceService);
    await editorManager.open(uri, { mode: 'reveal' });
}

/** Open a changed transcript file in the IDE's native SCM diff editor. */
export async function openTranscriptWorkspaceChange(
    filePath: string,
    workspaceService: WorkspaceService,
    editorManager: EditorManager,
    scmService: ScmService,
): Promise<void> {
    const trimmed = filePath.trim();
    if (!trimmed) {
        return;
    }
    const uri = resolveTranscriptWorkspaceFileUri(trimmed, workspaceService);
    const repository = scmService.findRepository(uri);
    const resource = repository?.provider.groups
        .flatMap(group => group.resources)
        .find(candidate => candidate.sourceUri.path.fsPath() === uri.path.fsPath());
    if (resource) {
        await resource.open();
        return;
    }
    // A newly-created or remotely-scoped file may not be in the SCM snapshot yet.
    // Opening the source editor is still the most useful native IDE fallback.
    await editorManager.open(uri, { mode: 'reveal' });
}

/** Reveal the IDE Source Control view for aggregate change actions. */
export async function openTranscriptWorkspaceChanges(
    shell: ApplicationShell,
    widgetManager: WidgetManager,
): Promise<void> {
    const widget = await widgetManager.getOrCreateWidget(QAAP_SCM_VIEW_CONTAINER_ID);
    if (!widget.isAttached) {
        await shell.addWidget(widget, { area: 'left' });
    }
    await shell.activateWidget(widget.id);
    const area = shell.getAreaFor(widget);
    if (area && area !== 'main' && !shell.isExpanded(area)) {
        shell.expandPanel(area);
    }
}

export function resolveTranscriptWorkspaceFileUri(filePath: string, workspaceService: WorkspaceService): URI {
    const trimmed = filePath.trim();
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
        return new URI(trimmed);
    }
    const absolute = toTranscriptAbsoluteFilePath(trimmed);
    if (absolute) {
        return FileUri.create(absolute);
    }
    const roots = workspaceService.tryGetRoots();
    if (roots.length > 0) {
        return roots[0].resource.resolve(trimmed.replace(/^\.?\//, ''));
    }
    return new URI(trimmed);
}

/** Absolute path on the backend (VPS or local) — not relative to the IDE's open folder. */
function toTranscriptAbsoluteFilePath(path: string): string | undefined {
    if (path.startsWith('/')) {
        return path;
    }
    if (/^[A-Za-z]:[\\/]/.test(path)) {
        return path.replace(/\\/g, '/');
    }
    return undefined;
}

export function resolveTranscriptWorkspaceRootUri(cwd: string, workspaceService: WorkspaceService): URI | undefined {
    const trimmed = cwd.trim();
    if (!trimmed || !isTranscriptWorkspaceFilesystemPath(trimmed)) {
        return undefined;
    }
    if (/^file:/i.test(trimmed)) {
        return new URI(trimmed);
    }
    const absolute = toTranscriptAbsoluteFilePath(trimmed);
    const cwdUri = absolute ? FileUri.create(absolute) : new URI(trimmed);
    for (const root of workspaceService.tryGetRoots()) {
        const relative = root.resource.relative(cwdUri);
        if (relative !== undefined && !relative.toString().startsWith('..')) {
            return cwdUri;
        }
    }
    // Project path from the hub may differ from the IDE's open folder — always honor cwd.
    return cwdUri;
}

/** Stable cache key for transcript Files/Terminal surfaces (one per project workspace). */
export function resolveTranscriptWorkspaceKey(cwd: string, workspaceService: WorkspaceService): string | undefined {
    const root = resolveTranscriptWorkspaceRootUri(cwd, workspaceService);
    const path = root ? resolveWorkspaceHostFsPath(root) : cwd.trim();
    if (!path) {
        return undefined;
    }
    const normalized = path.replace(/\/+$/, '') || path;
    return normalized || undefined;
}

/**
 * Wires transcript Files tab to the same IDE services as the workbench:
 * - {@link FileService} for list/read/write and file-change events
 * - {@link MonacoEditorProvider} for inline editor (TextMate, same model URI as main editor)
 * - {@link MarkdownPreviewHandler} for markdown preview (same as Preview view)
 * - {@link LabelProvider} for file/folder icons (same as Explorer)
 * - `file.newFile` / `file.newFolder` commands and {@link EditorManager} for open-in-workbench
 */
export function createTranscriptFilesViewServices(
    workspaceService: WorkspaceService,
    fileService: FileService,
    editorManager: EditorManager,
    commands: CommandRegistry,
    editorProvider?: MonacoEditorProvider,
    labelProvider?: LabelProvider,
    markdownPreviewHandler?: MarkdownPreviewHandler,
    decorationsService?: DecorationsService,
    colorRegistry?: ColorRegistry,
): TranscriptFilesViewServices {
    return {
        resolveRootUri: cwd => resolveTranscriptWorkspaceRootUri(cwd, workspaceService)?.toString(),
        listDirectory: async resourcePath => {
            const stat = await fileService.resolve(new URI(resourcePath));
            return (stat.children ?? []).map(child => ({
                name: child.name,
                resourcePath: child.resource.toString(),
                relativePath: child.name,
                isDirectory: child.isDirectory,
            } satisfies TranscriptFileTreeEntry));
        },
        relativePathForResource: (resourcePath, rootUri) => {
            const relative = new URI(rootUri).relative(new URI(resourcePath));
            return relative?.toString() ?? new URI(resourcePath).path.base;
        },
        readFile: async resourcePath => {
            const content = await fileService.readFile(new URI(resourcePath));
            return content.value.toString();
        },
        resolveFileIcon: labelProvider
            ? (resourcePath, isDirectory) => {
                if (isDirectory) {
                    return labelProvider.getIcon(URIIconReference.create('folder'));
                }
                return labelProvider.getIcon(new URI(resourcePath));
            }
            : undefined,
        getFileDecoration: decorationsService
            ? (resourcePath, isDirectory) => {
                try {
                    return resolveTranscriptFileDecoration(
                        decorationsService,
                        colorRegistry,
                        resourcePath,
                        isDirectory,
                    );
                } catch {
                    return undefined;
                }
            }
            : undefined,
        renderMarkdownPreview: markdownPreviewHandler
            ? (resourcePath, markdown) => markdownPreviewHandler.renderContent({
                content: markdown,
                originUri: new URI(resourcePath),
            })
            : undefined,
        createNewFile: parentResourcePath => {
            void executeTranscriptNewFileCommand(commands, workspaceService, parentResourcePath);
        },
        createNewFolder: parentResourcePath => {
            void executeTranscriptNewFolderCommand(commands, workspaceService, parentResourcePath);
        },
        openInEditor: relativePath => {
            void openTranscriptWorkspaceFile(relativePath, workspaceService, editorManager);
        },
        writeFile: async (resourcePath, content) => {
            await fileService.write(new URI(resourcePath), content);
        },
        createMonacoPreviewEditor: editorProvider
            ? (host, resourcePath, options) => createTranscriptPreviewMonacoEditor(
                host,
                resourcePath,
                editorProvider,
                options,
            )
            : undefined,
        watchFileTreeChanges: onChange => {
            const subscription = fileService.onDidFilesChange(() => {
                onChange();
            });
            return Disposable.create(() => subscription.dispose());
        },
        watchFileDecorations: decorationsService
            ? onChange => {
                let scheduled: ReturnType<typeof setTimeout> | undefined;
                const subscription = decorationsService.onDidChangeDecorations(() => {
                    // Coalesce decoration storms so Files preview I/O is not starved by
                    // continuous full-tree re-renders while SCM badges settle.
                    if (scheduled !== undefined) {
                        return;
                    }
                    scheduled = setTimeout(() => {
                        scheduled = undefined;
                        onChange();
                    }, 48);
                });
                return Disposable.create(() => {
                    if (scheduled !== undefined) {
                        clearTimeout(scheduled);
                        scheduled = undefined;
                    }
                    subscription.dispose();
                });
            }
            : undefined,
        localize: (key, defaultValue, ...args) => nls.localize(key, defaultValue, ...args),
    };
}

/** Prefer the highest-weight decoration with a letter (Explorer parity). */
export function resolveTranscriptFileDecoration(
    decorationsService: DecorationsService,
    colorRegistry: ColorRegistry | undefined,
    resourcePath: string,
    isDirectory: boolean,
): TranscriptFileDecoration | undefined {
    const decorations = decorationsService.getDecoration(new URI(resourcePath), isDirectory);
    if (decorations.length === 0) {
        return undefined;
    }
    const primary = [...decorations].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0];
    if (!primary.letter && !primary.colorId && !primary.tooltip) {
        return undefined;
    }
    const color = primary.colorId
        ? `var(${colorRegistry?.toCssVariableName(primary.colorId)
            ?? `--theia-${primary.colorId.replace(/\./g, '-')}`})`
        : undefined;
    return {
        color,
        letter: primary.letter,
        tooltip: primary.tooltip,
    };
}

function executeTranscriptNewFileCommand(
    commands: CommandRegistry,
    workspaceService: WorkspaceService,
    parentResourcePath?: string,
): void {
    if (parentResourcePath) {
        void commands.executeCommand('file.newFile', new URI(parentResourcePath));
        return;
    }
    const root = resolveTranscriptWorkspaceRootUri('', workspaceService);
    if (root) {
        void commands.executeCommand('file.newFile', root);
        return;
    }
    void commands.executeCommand('file.newFile');
}

function executeTranscriptNewFolderCommand(
    commands: CommandRegistry,
    workspaceService: WorkspaceService,
    parentResourcePath?: string,
): void {
    if (parentResourcePath) {
        void commands.executeCommand('file.newFolder', new URI(parentResourcePath));
        return;
    }
    const root = resolveTranscriptWorkspaceRootUri('', workspaceService);
    if (root) {
        void commands.executeCommand('file.newFolder', root);
        return;
    }
    void commands.executeCommand('file.newFolder');
}
