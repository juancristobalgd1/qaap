// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';

export interface TranscriptFilesMount {
    readonly root: HTMLElement;
    readonly dispose: Disposable;
    /** Selects a workspace file in the inline preview (relative or absolute path). */
    readonly revealFilePath?: (filePath: string) => Promise<void>;
    /**
     * Relocates the Files more-actions (⋯) control.
     * Pass a Work Hub header host to mount it left of the view selector;
     * pass `undefined` to restore it inside the preview header.
     */
    readonly attachMoreActionsHost?: (host: HTMLElement | undefined) => void;
}

export interface TranscriptTerminalSurface {
    readonly dispose: Disposable;
    readonly terminal: TerminalWidget;
    readonly mountHost: HTMLElement;
}
