// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { AIVariableResolutionRequest } from '@theia/ai-core';
import { FILE_VARIABLE } from '@theia/ai-core/lib/browser/file-variable-contribution';
import { IMAGE_CONTEXT_VARIABLE, ImageContextVariable } from '@theia/ai-chat/lib/common/image-context-variable';
import { URI, generateUuid, nls } from '@theia/core';
import { fileToStream } from '@theia/core/lib/common/stream';
import { FileUploadService } from '@theia/filesystem/lib/common/upload/file-upload';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import {
    buildPendingComposerContextArg,
    type StickyComposerContextEntry,
} from '../common/qaap-composer-context-entry';
import { isImageAttachmentFileName } from '../common/qaap-sticky-composer-attachment-utils';
import {
    normalizeAttachComposerImages,
    type QaapAttachComposerImageAttachment,
} from '../common/qaap-preview-feedback-context';
import {
    createImageContextFromDeviceFile,
} from '../common/qaap-mobile-composer-device-attach';

export {
    blobToBase64,
    createImageContextFromDeviceFile,
} from '../common/qaap-mobile-composer-device-attach';

export interface MobileComposerAttachHandlers {
    appendOptimistic(entry: StickyComposerContextEntry): void;
    finalizeOptimistic(id: string, request: AIVariableResolutionRequest): void;
    /**
     * Drops a pending attachment chip. `error` carries the real upload failure (or `undefined` when the
     * upload resolved without a request) so the surface can surface the concrete reason instead of the
     * opaque generic message — critical on mobile, where there is no console to inspect.
     */
    removeOptimistic(id: string, error?: unknown): void;
    /** Inserts `/skill-name` into the sticky composer draft (Cursor-style skill slash). */
    insertComposerSkill?: (skillName: string) => void;
    /**
     * Directory to upload device files into when no Theia workspace root is open — the mobile chat
     * surface runs against the project cwd without opening it as a workspace, so `tryGetRoots()` is
     * empty there. Without this the file upload would throw before any chip is shown.
     */
    readonly uploadTargetDir?: URI;
}

export interface MobileComposerDeviceAttachServices {
    readonly fileUploadService: FileUploadService;
    readonly fileService: FileService;
    readonly workspaceService: WorkspaceService;
}

export function pickFilesFromDevice(options: {
    accept?: string;
    multiple?: boolean;
}): Promise<File[]> {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = options.multiple ?? true;
        if (options.accept) {
            input.accept = options.accept;
        }
        input.style.display = 'none';
        document.body.append(input);

        const finish = (files: File[]): void => {
            input.remove();
            resolve(files);
        };

        input.addEventListener('change', () => {
            finish(input.files ? Array.from(input.files) : []);
        });

        input.click();
    });
}

async function uploadDeviceFileToWorkspace(
    file: File,
    root: URI,
    fileService: FileService,
    workspaceService: WorkspaceService,
): Promise<AIVariableResolutionRequest | undefined> {
    const targetUri = root.resolve(file.name);
    if (await fileService.exists(targetUri)) {
        await fileService.delete(targetUri);
    }
    await fileService.writeFile(targetUri, fileToStream(file));
    // Prefer a workspace-relative path when a root is open; otherwise fall back to the absolute file
    // URI, which the FILE_VARIABLE resolver still resolves (see FileVariableContribution.makeAbsolute).
    const wsPath = await workspaceService.getWorkspaceRelativePath(targetUri);
    return { variable: FILE_VARIABLE, arg: wsPath || targetUri.toString() };
}

async function uploadDeviceImageToWorkspace(
    file: File,
    root: URI,
    fileService: FileService,
    workspaceService: WorkspaceService,
): Promise<AIVariableResolutionRequest | undefined> {
    const request = await uploadDeviceFileToWorkspace(file, root, fileService, workspaceService);
    const path = request?.arg?.trim();
    if (!path) {
        return undefined;
    }
    return ImageContextVariable.createPathBasedRequest(path, file.name);
}

/**
 * Attaches a device image, preferring a workspace-file upload but falling back to an inline base64
 * image request when the upload fails or yields nothing. On the production VPS the workspace write can
 * be rejected (e.g. tenant-ownership 403 on a cwd outside the user's repo root); base64 keeps working
 * because it never touches the backend filesystem. Only when the fallback itself fails do we drop the
 * chip and surface the real error.
 */
async function attachImageWithInlineFallback(
    file: File,
    root: URI,
    services: MobileComposerDeviceAttachServices,
    handlers: MobileComposerAttachHandlers,
    entryId: string,
): Promise<void> {
    try {
        const request = await uploadDeviceImageToWorkspace(file, root, services.fileService, services.workspaceService);
        if (request) {
            handlers.finalizeOptimistic(entryId, request);
            return;
        }
    } catch (error) {
        // Swallow and try the inline fallback below; the error is only surfaced if that also fails.
        console.warn('[qaap] workspace image upload failed, falling back to inline base64', error);
    }
    try {
        handlers.finalizeOptimistic(entryId, await createImageContextFromDeviceFile(file));
    } catch (error) {
        handlers.removeOptimistic(entryId, error);
    }
}

function uniqueInlineImageName(name: string): string {
    const trimmed = name.trim() || 'preview-screenshot.png';
    const stamp = Date.now().toString(36);
    const dot = trimmed.lastIndexOf('.');
    return dot > 0 ? `${trimmed.slice(0, dot)}-${stamp}${trimmed.slice(dot)}` : `${trimmed}-${stamp}`;
}

function inlineImageToFile(image: QaapAttachComposerImageAttachment): File | undefined {
    try {
        const binary = atob(image.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new File([bytes], uniqueInlineImageName(image.name), { type: image.mimeType.trim() || 'image/png' });
    } catch {
        return undefined;
    }
}

/**
 * Persists inline base64 images (annotate-toolbar screenshots) into the workspace and returns
 * path-based imageContext requests — same shape as device-picker attachments, so downstream
 * prompt/preview rendering works unchanged. Unique file names avoid clobbering user files.
 */
export async function uploadInlineComposerImagesToWorkspace(
    images: readonly QaapAttachComposerImageAttachment[],
    fallbackDir: URI | undefined,
    fileService: FileService,
    workspaceService: WorkspaceService,
): Promise<AIVariableResolutionRequest[]> {
    const normalized = normalizeAttachComposerImages(images);
    if (!normalized.length) {
        return [];
    }
    const root = workspaceService.tryGetRoots()[0]?.resource ?? fallbackDir;
    if (!root) {
        return [];
    }
    const requests: AIVariableResolutionRequest[] = [];
    for (const image of normalized) {
        const file = inlineImageToFile(image);
        if (!file) {
            continue;
        }
        const request = await uploadDeviceImageToWorkspace(file, root, fileService, workspaceService);
        if (request) {
            requests.push(request);
        }
    }
    return requests;
}

export async function createFileContextFromDeviceFiles(
    files: readonly File[],
    fileUploadService: FileUploadService,
    workspaceService: WorkspaceService,
    fileService?: FileService,
): Promise<AIVariableResolutionRequest[]> {
    if (files.length === 0) {
        return [];
    }
    const root = workspaceService.tryGetRoots()[0]?.resource;
    if (!root) {
        throw new Error(nls.localize(
            'qaap/mobileProjects/stickyComposerAttachNoWorkspace',
            'Open a workspace before attaching files from this device.',
        ));
    }

    if (fileService) {
        const requests: AIVariableResolutionRequest[] = [];
        for (const file of files) {
            const request = await uploadDeviceFileToWorkspace(file, root, fileService, workspaceService);
            if (request) {
                requests.push(request);
            }
        }
        return requests;
    }

    const formData = new FormData();
    for (const file of files) {
        formData.append('upload', file);
    }
    const result = await fileUploadService.upload(root, { source: formData });
    const requests: AIVariableResolutionRequest[] = [];
    for (const uriStr of result.uploaded) {
        const wsPath = await workspaceService.getWorkspaceRelativePath(new URI(uriStr));
        if (wsPath) {
            requests.push({ variable: FILE_VARIABLE, arg: wsPath });
        }
    }
    return requests;
}

function createPendingImageEntry(file: File): StickyComposerContextEntry {
    const id = generateUuid();
    return {
        id,
        pending: true,
        displayName: file.name || nls.localize('qaap/mobileProjects/stickyComposerAttachmentImage', 'Image'),
        localPreviewSrc: URL.createObjectURL(file),
        request: {
            variable: IMAGE_CONTEXT_VARIABLE,
            arg: buildPendingComposerContextArg(id),
        },
    };
}

function createPendingFileEntry(file: File): StickyComposerContextEntry {
    const id = generateUuid();
    const isImage = isImageAttachmentFileName(file.name);
    return {
        id,
        pending: true,
        displayName: file.name,
        localPreviewSrc: isImage ? URL.createObjectURL(file) : undefined,
        request: {
            variable: isImage ? IMAGE_CONTEXT_VARIABLE : FILE_VARIABLE,
            arg: buildPendingComposerContextArg(id),
        },
    };
}

export function attachDeviceImagesOptimistic(
    files: readonly File[],
    handlers: MobileComposerAttachHandlers,
): void {
    for (const file of files) {
        const entry = createPendingImageEntry(file);
        handlers.appendOptimistic(entry);
        void createImageContextFromDeviceFile(file)
            .then(request => handlers.finalizeOptimistic(entry.id, request))
            .catch(error => handlers.removeOptimistic(entry.id, error));
    }
}

export function attachDeviceFilesOptimistic(
    files: readonly File[],
    services: MobileComposerDeviceAttachServices,
    handlers: MobileComposerAttachHandlers,
): void {
    // On the mobile chat surface there is usually no open Theia workspace root, so upload into the
    // project directory the composer is bound to. When neither is available, images still work
    // via inline base64 fallback; non-image files fail per-chip with a visible error.
    const root = services.workspaceService.tryGetRoots()[0]?.resource ?? handlers.uploadTargetDir;

    for (const file of files) {
        const entry = createPendingFileEntry(file);
        // Append the optimistic chip FIRST so the user sees the file land immediately,
        // before any upload / fallback logic runs.
        handlers.appendOptimistic(entry);

        if (isImageAttachmentFileName(file.name)) {
            if (root) {
                void attachImageWithInlineFallback(file, root, services, handlers, entry.id);
            } else {
                // No workspace root — go straight to inline base64 (works without backend FS).
                void createImageContextFromDeviceFile(file)
                    .then(request => handlers.finalizeOptimistic(entry.id, request))
                    .catch(error => handlers.removeOptimistic(entry.id, error));
            }
            continue;
        }

        if (!root) {
            handlers.removeOptimistic(entry.id, new Error(nls.localize(
                'qaap/mobileProjects/stickyComposerAttachNoWorkspace',
                'Open a workspace before attaching files from this device.',
            )));
            continue;
        }

        void uploadDeviceFileToWorkspace(file, root, services.fileService, services.workspaceService)
            .then(request => {
                if (request) {
                    handlers.finalizeOptimistic(entry.id, request);
                } else {
                    handlers.removeOptimistic(entry.id);
                }
            })
            .catch(error => handlers.removeOptimistic(entry.id, error));
    }
}

export async function attachDeviceImagesFromPicker(): Promise<AIVariableResolutionRequest[]> {
    const files = await pickFilesFromDevice({ accept: 'image/*,.svg,image/svg+xml', multiple: true });
    if (files.length === 0) {
        return [];
    }
    return Promise.all(files.map(file => createImageContextFromDeviceFile(file)));
}

export async function attachDeviceFilesFromPicker(
    services: MobileComposerDeviceAttachServices,
): Promise<AIVariableResolutionRequest[]> {
    const files = await pickFilesFromDevice({ multiple: true });
    return createFileContextFromDeviceFiles(
        files,
        services.fileUploadService,
        services.workspaceService,
        services.fileService,
    );
}
