// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { QAAP_LEGAL_PRIVACY_HREF, QAAP_LEGAL_TERMS_HREF } from './qaap-legal-pages';

const productRoot = path.resolve(__dirname, '../..');
const legalDir = path.join(productRoot, 'resources/legal');

describe('Qaap legal pages', () => {

    it('keeps public hrefs on the /legal/ prefix', () => {
        expect(QAAP_LEGAL_TERMS_HREF).to.equal('/legal/terms.html');
        expect(QAAP_LEGAL_PRIVACY_HREF).to.equal('/legal/privacy.html');
    });

    it('ships terms, privacy, and shared CSS next to the login gate', () => {
        for (const name of ['terms.html', 'privacy.html', 'legal.css']) {
            const filePath = path.join(legalDir, name);
            expect(fs.existsSync(filePath), filePath).to.equal(true);
            expect(fs.statSync(filePath).size).to.be.greaterThan(80);
        }
        const terms = fs.readFileSync(path.join(legalDir, 'terms.html'), 'utf8');
        const privacy = fs.readFileSync(path.join(legalDir, 'privacy.html'), 'utf8');
        expect(terms).to.include('<h1>Terms of Use</h1>');
        expect(privacy).to.include('<h1>Privacy Notice</h1>');
        expect(terms).to.include('lang="en"');
        expect(privacy).to.include('lang="en"');
        expect(terms).to.include('/legal/privacy.html');
        expect(privacy).to.include('/legal/terms.html');
    });

    it('wires the pre-bundle login footer to the same hrefs', () => {
        const gate = fs.readFileSync(path.join(productRoot, 'resources/qaap-login-gate.js'), 'utf8');
        expect(gate).to.include(`href="${QAAP_LEGAL_TERMS_HREF}"`);
        expect(gate).to.include(`href="${QAAP_LEGAL_PRIVACY_HREF}"`);
        expect(gate).to.not.include('data-qaap-link');
    });
});
