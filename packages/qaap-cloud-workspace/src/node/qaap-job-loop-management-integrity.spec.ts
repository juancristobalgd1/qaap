// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapCreateJobLoopTemplateRequest } from '../common/qaap-job-loop-template';
import { withQaapJobLoopManagementLock } from './qaap-job-loop-management-lock';
import { QaapJobLoopTemplateStore } from './qaap-job-loop-template-store';
import { QaapJobLoopTriggerStore } from './qaap-job-loop-trigger-store';

const templateRequest: QaapCreateJobLoopTemplateRequest = {
    name: 'Integrity template',
    definition: {
        graph: { nodes: [{ key: 'step', request: { command: 'true', cwd: '/repo' } }] },
        until: { nodeKey: 'step', operator: 'truthy' },
    },
};

class IntegrityTemplateStore extends QaapJobLoopTemplateStore {
    constructor(protected readonly stateDirectory: string, protected readonly sharedLockPath: string) { super(); }
    initialize(): void { this.init(); }
    protected override storeDirectory(): string { return this.stateDirectory; }
    protected override managementLockPath(): string { return this.sharedLockPath; }
}

class IntegrityTriggerStore extends QaapJobLoopTriggerStore {
    constructor(protected readonly stateDirectory: string, protected readonly sharedLockPath: string) { super(); }
    initialize(): void { this.init(); }
    protected override directory(): string { return this.stateDirectory; }
    protected override managementLockPath(): string { return this.sharedLockPath; }
}

describe('Job loop management cross-index integrity', () => {
    let root: string;
    let lockPath: string;
    let templates: IntegrityTemplateStore;
    let triggers: IntegrityTriggerStore;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-job-loop-integrity-'));
        lockPath = path.join(root, 'management.lock');
        templates = new IntegrityTemplateStore(path.join(root, 'templates'), lockPath);
        triggers = new IntegrityTriggerStore(path.join(root, 'triggers'), lockPath);
        templates.initialize();
        triggers.initialize();
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('never leaves an orphan trigger when create and template delete race', async () => {
        const template = await templates.create(templateRequest, 'alice');
        const createTrigger = withQaapJobLoopManagementLock(lockPath, async () => {
            if (!templates.get('alice', template.id)) { return false; }
            await triggers.create('alice', { templateId: template.id, title: 'Concurrent trigger', type: 'interval' });
            return true;
        });
        const deleteTemplate = withQaapJobLoopManagementLock(lockPath, async () => {
            if (triggers.list('alice').some(trigger => trigger.templateId === template.id)) { return false; }
            return templates.delete(template.id, template.revision, 'alice').then(Boolean);
        });

        await Promise.all([createTrigger, deleteTemplate]);
        const templateExists = templates.get('alice', template.id) !== undefined;
        const matchingTriggers = triggers.list('alice').filter(trigger => trigger.templateId === template.id);
        expect(matchingTriggers.length === 0 || templateExists).to.equal(true);
    });
});
