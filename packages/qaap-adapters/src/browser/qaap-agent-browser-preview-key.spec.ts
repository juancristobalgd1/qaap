// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { qaapAgentBrowserPreviewWidgetKey, qaapPreviewWidgetUri } from './qaap-preview-widget-uri';

describe('Qaap agent browser preview widget key', () => {
    it('keeps Work Hub and IDE browser previews independent for the same agent task', () => {
        const workHubKey = qaapAgentBrowserPreviewWidgetKey('task-42', 'work-hub');
        const ideKey = qaapAgentBrowserPreviewWidgetKey('task-42', 'ide');

        expect(workHubKey).not.to.deep.equal(ideKey);
        expect(qaapPreviewWidgetUri(workHubKey).toString()).not.to.equal(qaapPreviewWidgetUri(ideKey).toString());
    });
});
