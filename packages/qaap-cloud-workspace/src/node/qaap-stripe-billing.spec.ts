// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as crypto from 'crypto';
import {
    extractCheckoutPlanAndLogin,
    isCheckoutSessionPaid,
    isQaapPayablePlanId,
    verifyStripeWebhookEvent,
} from './qaap-stripe-billing';

describe('qaap-stripe-billing', () => {
    it('accepts only pro/team as payable plans', () => {
        expect(isQaapPayablePlanId('pro')).to.equal(true);
        expect(isQaapPayablePlanId('team')).to.equal(true);
        expect(isQaapPayablePlanId('starter')).to.equal(false);
    });

    it('extracts login and plan from Checkout session metadata', () => {
        const extracted = extractCheckoutPlanAndLogin({
            client_reference_id: 'alice',
            metadata: { planId: 'pro', login: 'alice' },
        });
        expect(extracted.login).to.equal('alice');
        expect(extracted.planId).to.equal('pro');
    });

    it('treats paid or complete Checkout sessions as grantable', () => {
        expect(isCheckoutSessionPaid({ payment_status: 'paid' })).to.equal(true);
        expect(isCheckoutSessionPaid({ status: 'complete' })).to.equal(true);
        expect(isCheckoutSessionPaid({ payment_status: 'unpaid', status: 'open' })).to.equal(false);
    });

    it('verifies a valid Stripe webhook signature', () => {
        const secret = 'whsec_test_secret';
        const payload = Buffer.from(JSON.stringify({
            type: 'checkout.session.completed',
            data: { object: { mode: 'subscription' } },
        }), 'utf8');
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const signature = crypto
            .createHmac('sha256', secret)
            .update(`${timestamp}.${payload.toString('utf8')}`, 'utf8')
            .digest('hex');
        const event = verifyStripeWebhookEvent(payload, `t=${timestamp},v1=${signature}`, secret);
        expect(event.type).to.equal('checkout.session.completed');
    });
});
