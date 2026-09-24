// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { switchQaapMonorepoPreviewApp } from './qaap-monorepo-preview-switch';

describe('switchQaapMonorepoPreviewApp', () => {

    it('stops app A before selecting and starting app B', async () => {
        const events: string[] = [];
        await switchQaapMonorepoPreviewApp({
            appCount: 2,
            currentAppPath: 'apps/a',
            nextApp: 'app-b',
            nextAppPath: 'apps/b',
            previewIsActive: true,
            stopActivePreview: async () => { events.push('stop:app-a'); },
            isCurrent: () => true,
            applySelection: app => { events.push(`select:${app}`); },
            launchSelectedPreview: async () => { events.push('start:app-b'); },
        });

        expect(events).to.deep.equal(['stop:app-a', 'select:app-b', 'start:app-b']);
    });

    it('does not launch an app after a newer picker choice supersedes the hand-off', async () => {
        const events: string[] = [];
        const result = await switchQaapMonorepoPreviewApp({
            appCount: 2,
            currentAppPath: 'apps/a',
            nextApp: 'app-b',
            nextAppPath: 'apps/b',
            previewIsActive: true,
            stopActivePreview: async () => { events.push('stop:app-a'); },
            isCurrent: () => false,
            applySelection: app => { events.push(`select:${app}`); },
            launchSelectedPreview: async () => { events.push('start:app-b'); },
        });

        expect(result).to.equal('superseded');
        expect(events).to.deep.equal(['stop:app-a']);
    });

    it('leaves the replacement selected when its launch reports a failure', async () => {
        const events: string[] = [];
        let failure: Error | undefined;
        try {
            await switchQaapMonorepoPreviewApp({
                appCount: 2,
                currentAppPath: 'apps/a',
                nextApp: 'app-b',
                nextAppPath: 'apps/b',
                previewIsActive: true,
                stopActivePreview: async () => { events.push('stop:app-a'); },
                isCurrent: () => true,
                applySelection: app => { events.push(`select:${app}`); },
                launchSelectedPreview: async () => {
                    events.push('start:app-b');
                    throw new Error('app B could not start');
                },
            });
        } catch (error) {
            failure = error as Error;
        }

        expect(failure?.message).to.equal('app B could not start');
        expect(events).to.deep.equal(['stop:app-a', 'select:app-b', 'start:app-b']);
    });

    it('is a no-op when the user selects the already running app', async () => {
        const events: string[] = [];
        const result = await switchQaapMonorepoPreviewApp({
            appCount: 2,
            currentAppPath: 'apps/a',
            nextApp: 'app-a',
            nextAppPath: 'apps/a',
            previewIsActive: true,
            stopActivePreview: async () => { events.push('stop'); },
            isCurrent: () => true,
            applySelection: () => { events.push('select'); },
            launchSelectedPreview: async () => { events.push('start'); },
        });

        expect(result).to.equal('no-op');
        expect(events).to.deep.equal([]);
    });
});
