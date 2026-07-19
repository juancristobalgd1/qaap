// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Resolves the mounted iframe slot without assuming the base mini-browser constructor has already
 * assigned its `frame` field. Toolbar construction intentionally happens before that assignment.
 */
export function getQaapPreviewFrameSlot(frame: HTMLIFrameElement | undefined): HTMLElement | undefined {
    return frame?.parentElement ?? undefined;
}
