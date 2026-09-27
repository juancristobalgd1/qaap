// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import {
    coerceQaapPreviewWidgetKey,
    isQaapPreviewWidgetId,
    isQaapPreviewWidgetKey,
    isQaapPreviewWidgetUri,
    QAAP_PREVIEW_WIDGET_SCHEME,
    qaapPreviewWidgetKeyFromCoordinates,
    qaapPreviewWidgetUri,
} from './qaap-preview-widget-uri';

/** Mirrors `LEGACY_PREVIEW_URI` without importing DOM-bound modules. */
const LEGACY_PREVIEW_URI = new URI().withScheme(QAAP_PREVIEW_WIDGET_SCHEME);

const PROJECT_A = { workspaceId: 'file:///workspace/repos/users/alice/alice/app-a', projectId: 'file:///workspace/repos/users/alice/alice/app-a' };
const PROJECT_B = { workspaceId: 'file:///workspace/repos/users/alice/alice/app-b', projectId: 'file:///workspace/repos/users/alice/alice/app-b' };

describe('qaap-preview-widget-uri', () => {

    it('returns the legacy preview URI without a key', () => {
        expect(qaapPreviewWidgetUri().isEqual(LEGACY_PREVIEW_URI)).to.equal(true);
    });

    it('is deterministic per project', () => {
        expect(qaapPreviewWidgetUri(PROJECT_A).toString()).to.equal(qaapPreviewWidgetUri(PROJECT_A).toString());
    });

    it('is distinct across projects', () => {
        expect(qaapPreviewWidgetUri(PROJECT_A).toString()).to.not.equal(qaapPreviewWidgetUri(PROJECT_B).toString());
        expect(qaapPreviewWidgetUri(PROJECT_A).isEqual(LEGACY_PREVIEW_URI)).to.equal(false);
    });

    it('distinguishes projects within the same workspace (monorepo apps)', () => {
        const appOne = { workspaceId: PROJECT_A.workspaceId, projectId: `${PROJECT_A.projectId}/apps/one` };
        const appTwo = { workspaceId: PROJECT_A.workspaceId, projectId: `${PROJECT_A.projectId}/apps/two` };
        expect(qaapPreviewWidgetUri(appOne).toString()).to.not.equal(qaapPreviewWidgetUri(appTwo).toString());
    });

    it('recognizes both legacy and project-scoped URIs and widget ids', () => {
        expect(isQaapPreviewWidgetUri(LEGACY_PREVIEW_URI)).to.equal(true);
        expect(isQaapPreviewWidgetUri(qaapPreviewWidgetUri(PROJECT_A))).to.equal(true);
        expect(isQaapPreviewWidgetUri(undefined)).to.equal(false);

        expect(isQaapPreviewWidgetId('mini-browser:__minibrowser__preview__')).to.equal(true);
        expect(isQaapPreviewWidgetId('mini-browser:__minibrowser__preview__:/abc/def')).to.equal(true);
        expect(isQaapPreviewWidgetId('mini-browser:http://example.com')).to.equal(false);
        expect(isQaapPreviewWidgetId(undefined)).to.equal(false);
    });

    it('builds a widget key from probe coordinates and ignores blanks', () => {
        expect(qaapPreviewWidgetKeyFromCoordinates(PROJECT_A.workspaceId, PROJECT_A.projectId)).to.deep.equal(PROJECT_A);
        expect(qaapPreviewWidgetKeyFromCoordinates('  ', PROJECT_A.projectId)).to.equal(undefined);
        expect(qaapPreviewWidgetKeyFromCoordinates(PROJECT_A.workspaceId, undefined)).to.equal(undefined);
        expect(isQaapPreviewWidgetKey(PROJECT_A)).to.equal(true);
        expect(isQaapPreviewWidgetKey({ workspaceId: PROJECT_A.workspaceId })).to.equal(false);
    });

    it('picks a widget key out of mini-browser.openUrl command args', () => {
        const key = coerceQaapPreviewWidgetKey([
            'https://example.test/qaap-preview/abc/',
            PROJECT_B,
        ]);
        expect(key).to.deep.equal(PROJECT_B);
        expect(qaapPreviewWidgetUri(key).toString()).to.not.equal(qaapPreviewWidgetUri(PROJECT_A).toString());
        expect(coerceQaapPreviewWidgetKey(['https://example.test/qaap-preview/abc/'])).to.equal(undefined);
    });
});
