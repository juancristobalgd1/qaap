// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Client-only optimistic attachment preview for pending transcript user rows. */
export interface QaapTranscriptUserImagePreview {
    readonly src: string;
    readonly fileName: string;
    /** Workspace path used to hydrate previews for persisted attachment preamble rows. */
    readonly wsRelativePath?: string;
}

export function isSvgImagePreviewFileName(fileName: string): boolean {
    return fileName.toLowerCase().endsWith('.svg');
}
