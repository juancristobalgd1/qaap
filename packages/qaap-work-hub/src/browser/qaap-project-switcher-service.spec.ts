// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { QaapProjectSwitcherService } from './qaap-project-switcher-service';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

const cachedProject = { id: 'github:acme/demo', name: 'demo', branch: 'main' } as unknown as MobileProjectEntry;
const freshProject = { id: 'github:acme/fresh', name: 'fresh', branch: 'main' } as unknown as MobileProjectEntry;

/** Picker under test; the quick pick is replaced by a capture of the labels it would show. */
function harness(loadProjects: () => Promise<MobileProjectEntry[]>, timeoutMs: number): { service: QaapProjectSwitcherService; shown: () => string[] } {
    const service = new QaapProjectSwitcherService();
    const labels: string[] = [];
    Object.assign(service, {
        pickerLoadTimeoutMs: timeoutMs,
        projectsService: {
            loadProjects,
            peekCachedProjects: (): MobileProjectEntry[] => [cachedProject],
            isDesktop: (): boolean => false,
        },
        quickInputService: {
            showQuickPick: async (items: Array<{ label?: string }>): Promise<undefined> => {
                labels.push(...items.map(item => item.label ?? ''));
                return undefined;
            },
        },
    });
    return { service, shown: () => labels };
}

describe('QaapProjectSwitcherService.showProjectPicker', () => {

    useSuiteJSDOM();

    it('opens with the cached repositories when the fresh load never settles (status bar click was a silent no-op)', async () => {
        const { service, shown } = harness(() => new Promise<MobileProjectEntry[]>(() => undefined), 5);
        await service.showProjectPicker();
        expect(shown()).to.include('demo');
    });

    it('opens with the cached repositories when the fresh load fails', async () => {
        const { service, shown } = harness(() => Promise.reject(new Error('offline')), 1000);
        await service.showProjectPicker();
        expect(shown()).to.include('demo');
    });

    it('lists the fresh repositories when they arrive in time', async () => {
        const { service, shown } = harness(async () => [freshProject], 1000);
        await service.showProjectPicker();
        expect(shown()).to.include('fresh');
        expect(shown()).to.not.include('demo');
    });
});
