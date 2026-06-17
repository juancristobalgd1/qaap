// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const IMAGE_FILE_EXTENSIONS = new Set([
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'svg',
    'heic',
    'heif',
]);

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    heic: 'image/heic',
    heif: 'image/heif',
};

export function isImageAttachmentFileName(fileName: string): boolean {
    const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : '';
    return IMAGE_FILE_EXTENSIONS.has(extension);
}

export function resolveImageAttachmentMimeType(fileName: string, preferredMimeType?: string): string {
    if (preferredMimeType?.startsWith('image/')) {
        return preferredMimeType;
    }
    const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : '';
    return IMAGE_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}
