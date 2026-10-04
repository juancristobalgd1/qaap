// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { MessageService } from '@theia/core/lib/common/message-service';
import {
    QAAP_SERVICE_WORKER_UPDATE_EVENT,
    QaapServiceWorkerUpdateContribution,
    QaapServiceWorkerUpdateHost,
} from './qaap-service-worker-update-contribution';

class TestUpdateContribution extends QaapServiceWorkerUpdateContribution {
    readonly host: QaapServiceWorkerUpdateHost = new EventTarget();
    prompts: string[] = [];
    answer: (choice: string) => void = () => undefined;

    protected override readonly messageService = {
        info: (message: string, ...actions: string[]) => {
            this.prompts.push(message);
            return new Promise<string | undefined>(resolve => {
                this.answer = choice => resolve(actions.includes(choice) ? choice : undefined);
            });
        }
    } as unknown as MessageService;

    protected override updateHost(): QaapServiceWorkerUpdateHost {
        return this.host;
    }
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('QaapServiceWorkerUpdateContribution', () => {

    it('stays silent when no update was announced', () => {
        const contribution = new TestUpdateContribution();
        contribution.onStart();
        expect(contribution.prompts).to.deep.equal([]);
    });

    it('offers an update announced before the application started', async () => {
        const contribution = new TestUpdateContribution();
        let applied = 0;
        contribution.host.__qaapServiceWorkerUpdate = { apply: () => { applied++; } };
        contribution.onStart();
        expect(contribution.prompts).to.have.length(1);
        contribution.answer('Reload');
        await flush();
        expect(applied).to.equal(1);
    });

    it('offers an update announced later only once while the prompt is open', async () => {
        const contribution = new TestUpdateContribution();
        contribution.onStart();
        contribution.host.__qaapServiceWorkerUpdate = { apply: () => undefined };
        contribution.host.dispatchEvent(new Event(QAAP_SERVICE_WORKER_UPDATE_EVENT));
        contribution.host.dispatchEvent(new Event(QAAP_SERVICE_WORKER_UPDATE_EVENT));
        expect(contribution.prompts).to.have.length(1);
    });

    it('does not reload when the prompt is dismissed', async () => {
        const contribution = new TestUpdateContribution();
        let applied = 0;
        contribution.host.__qaapServiceWorkerUpdate = { apply: () => { applied++; } };
        contribution.onStart();
        contribution.answer('dismissed');
        await flush();
        expect(applied).to.equal(0);
    });

    it('applies the newest announced update', async () => {
        const contribution = new TestUpdateContribution();
        const applied: string[] = [];
        contribution.host.__qaapServiceWorkerUpdate = { apply: () => applied.push('first') };
        contribution.onStart();
        contribution.host.__qaapServiceWorkerUpdate = { apply: () => applied.push('second') };
        contribution.answer('Reload');
        await flush();
        expect(applied).to.deep.equal(['second']);
    });
});
