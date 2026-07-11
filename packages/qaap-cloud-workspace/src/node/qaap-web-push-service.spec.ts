// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapWebPushService } from './qaap-web-push-service';

describe('QaapWebPushService VAPID configuration', () => {

    const originalPub = process.env.QAAP_VAPID_PUBLIC_KEY;
    const originalPriv = process.env.QAAP_VAPID_PRIVATE_KEY;

    const restore = (key: string, value: string | undefined): void => {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    };

    afterEach(() => {
        restore('QAAP_VAPID_PUBLIC_KEY', originalPub);
        restore('QAAP_VAPID_PRIVATE_KEY', originalPriv);
    });

    const initWithWarnCapture = (): string => {
        const service = Object.create(QaapWebPushService.prototype) as QaapWebPushService;
        const original = console.warn;
        let captured = '';
        console.warn = (...args: unknown[]): void => { captured += args.join(' '); };
        try {
            (service as unknown as { init(): void }).init();
        } finally {
            console.warn = original;
        }
        return captured;
    };

    it('isConfigured requires both VAPID keys', () => {
        const service = Object.create(QaapWebPushService.prototype) as QaapWebPushService;
        delete process.env.QAAP_VAPID_PUBLIC_KEY;
        delete process.env.QAAP_VAPID_PRIVATE_KEY;
        expect(service.isConfigured()).to.equal(false);
        process.env.QAAP_VAPID_PUBLIC_KEY = 'pub';
        expect(service.isConfigured()).to.equal(false); // only one key
        process.env.QAAP_VAPID_PRIVATE_KEY = 'priv';
        expect(service.isConfigured()).to.equal(true);
    });

    it('warns at init when VAPID keys are missing — not silently disabled (ONB-5)', () => {
        delete process.env.QAAP_VAPID_PUBLIC_KEY;
        delete process.env.QAAP_VAPID_PRIVATE_KEY;
        const warned = initWithWarnCapture();
        expect(warned).to.contain('qaap-web-push');
        expect(warned.toLowerCase()).to.contain('disabled');
    });

    it('stays quiet at init when VAPID keys are present', () => {
        process.env.QAAP_VAPID_PUBLIC_KEY = 'pub';
        process.env.QAAP_VAPID_PRIVATE_KEY = 'priv';
        expect(initWithWarnCapture()).to.equal('');
    });
});
