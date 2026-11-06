// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { BaseWidget } from '@theia/core/lib/browser/widgets/widget';
import { Widget } from '@theia/core/lib/browser/widgets';
import { QaapWindowTitleUpdater } from './qaap-window-title-updater';
import { qaapPreviewWindowTitle } from './qaap-preview-window-title';
import { qaapPreviewWidgetKeyFromCoordinates, qaapPreviewWidgetUri } from './qaap-preview-widget-uri';

disableJSDOM();

interface RecordedTitleParts {
    readonly [key: string]: string | undefined;
}

describe('qaap-preview-window-title', () => {

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    it('returns a readable label, never a project id', () => {
        const title = qaapPreviewWindowTitle();
        expect(title).to.equal('Preview');
        expect(title).to.not.match(/^[0-9a-z]{6,}$/);
    });

    describe('QaapWindowTitleUpdater', () => {

        const projectKey = qaapPreviewWidgetKeyFromCoordinates('file:///workspace/qaap', 'file:///workspace/qaap/app');
        const previewUri = qaapPreviewWidgetUri(projectKey);

        function createUpdater(recorded: RecordedTitleParts[]): QaapWindowTitleUpdater {
            const updater = new QaapWindowTitleUpdater();
            const internals = updater as unknown as Record<string, unknown>;
            internals['windowTitleService'] = { update: (parts: RecordedTitleParts) => recorded.push(parts) };
            internals['labelProvider'] = {
                getLongName: (uri: URI) => uri.path.toString(),
                getName: (uri: URI) => uri.path.base,
            };
            return updater;
        }

        function widgetFor(uri: URI | undefined): Widget {
            // NavigatableWidget.is requires a real BaseWidget instance, so a plain object would skip the URI branch.
            const widget = new BaseWidget();
            widget.title.label = 'Preview';
            Object.assign(widget, { getResourceUri: () => uri, createMoveToUri: () => undefined });
            return widget;
        }

        it('reports a readable label for a project preview tab instead of the digest', () => {
            const recorded: RecordedTitleParts[] = [];
            createUpdater(recorded)['updateTitleWidget'](widgetFor(previewUri));
            expect(recorded).to.have.length(1);
            expect(recorded[0].activeEditorShort).to.equal(qaapPreviewWindowTitle());
            expect(recorded[0].activeEditorLong).to.equal(qaapPreviewWindowTitle());
            expect(recorded[0].activeFolderShort).to.equal(undefined);
        });

        it('keeps the upstream behavior for ordinary editors', () => {
            const recorded: RecordedTitleParts[] = [];
            createUpdater(recorded)['updateTitleWidget'](widgetFor(new URI('file:///workspace/qaap/src/index.ts')));
            expect(recorded).to.have.length(1);
            expect(recorded[0].activeEditorShort).to.equal('index.ts');
        });

        it('falls back to the widget label when there is no resource URI', () => {
            const recorded: RecordedTitleParts[] = [];
            createUpdater(recorded)['updateTitleWidget'](widgetFor(undefined));
            expect(recorded[0].activeEditorShort).to.equal('Preview');
        });
    });
});
