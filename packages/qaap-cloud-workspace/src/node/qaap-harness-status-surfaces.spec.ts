// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Guard: the IDE AI configuration view and the Work Hub settings sheet must show the same harness
 * status. Both embed the one `QaapHarnessConfigurationWidget`, which reads `/harness-status` served
 * by this package; a second widget or endpoint for either surface would let them disagree.
 */
describe('harness status is shared by the IDE and the Work Hub', () => {
    const packagesRoot = resolve(__dirname, '../../..');
    const read = (relativePath: string): string => readFileSync(resolve(packagesRoot, relativePath), 'utf8');

    it('embeds the same widget in both surfaces and reads one backend status endpoint', () => {
        const widget = read('qaap-ai-config/src/browser/qaap-harness-configuration-widget.tsx');
        const ideContainer = read('qaap-ai-config/src/browser/qaap-ai-configuration-container-widget.ts');
        const workHubSheet = read('qaap-work-hub/src/browser/mobile-work-hub-preferences-sheet.ts');
        const endpoint = read('qaap-cloud-workspace/src/node/qaap-agent-task-endpoint.ts');

        const widgetId = /static readonly ID = '([^']+)'/.exec(widget)?.[1];
        expect(widgetId).to.equal('qaap-harness-configuration-widget');
        expect(ideContainer).to.include('getOrCreateWidget(QaapHarnessConfigurationWidget.ID)');
        expect(workHubSheet).to.match(new RegExp(`agents: '${widgetId}'`));

        const statusFetches = widget.match(/fetch\('\/qaap\/api\/agent-tasks\/harness-status'/g) ?? [];
        expect(statusFetches).to.have.length(1);
        expect(endpoint).to.include('`${QAAP_AGENT_TASK_API_PATH}/harness-status`');
    });
});
