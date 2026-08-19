// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    qaapPreviewWidgetKeyFromCoordinates,
    type QaapPreviewWidgetKey,
} from '@theia/qaap-adapters/lib/browser/qaap-preview-widget-uri';
import { normalizeQaapPreviewProjectId } from '@theia/qaap-mobile-shell/lib/common/qaap-preview-identity';

/**
 * Resolves the mini-browser widget key for a Work Hub project card.
 *
 * Prefer the clone URI: hub routing keys (`ws:`, `recent:`, `github:…`) are not the registry
 * identity, but the file URI is stable across those entry flows.
 */
export function qaapHubPreviewWidgetKeyFromProject(project: {
    readonly id?: string;
    readonly uri?: { toString(): string };
    readonly workspaceId?: string;
    readonly projectId?: string;
}): QaapPreviewWidgetKey | undefined {
    const fromStored = qaapPreviewWidgetKeyFromCoordinates(project.workspaceId, project.projectId);
    if (fromStored) {
        return fromStored;
    }
    const uri = project.uri?.toString();
    const fromUri = qaapPreviewWidgetKeyFromCoordinates(uri, uri);
    if (fromUri) {
        return fromUri;
    }
    const normalized = project.id ? normalizeQaapPreviewProjectId(project.id) : '';
    return qaapPreviewWidgetKeyFromCoordinates(normalized, normalized);
}
