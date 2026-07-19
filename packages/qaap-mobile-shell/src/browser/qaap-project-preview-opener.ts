// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Structural view of the project-scoped preview API implemented by `QaapMiniBrowserOpenHandler`
 * (`@theia/qaap-adapters`). Declared structurally so `qaap-mobile-shell` does not take a package
 * dependency on `qaap-adapters`, and so deployments that only bind the upstream mini-browser
 * handler degrade gracefully to the single shared preview tab.
 *
 * Keep {@link QaapPreviewWidgetKey} in sync with `qaap-preview-widget-uri.ts`.
 */
export interface QaapPreviewWidgetKey {
    readonly workspaceId: string;
    readonly projectId: string;
}

export interface QaapProjectPreviewOpener {
    openProjectPreview(startPage: string, key: QaapPreviewWidgetKey): Promise<unknown>;
}
