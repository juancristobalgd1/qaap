// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { QaapSupportedLocales } from './qaap-supported-locales';

const GATE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../resources/qaap-login-gate.js'), 'utf8');

describe('QaapSupportedLocales', () => {

    it('ships English only for launch (audit L1)', () => {
        expect([...QaapSupportedLocales.LOCALES]).to.deep.equal(['en']);
        expect(QaapSupportedLocales.isLocalizationEnabled()).to.equal(false);
    });

    it('keeps the login gate list in sync with LOCALES', () => {
        const match = /var QAAP_SUPPORTED_LOCALES = (\[[^\]]*\]);/.exec(GATE_SOURCE);
        expect(match, 'QAAP_SUPPORTED_LOCALES in qaap-login-gate.js').to.not.equal(null);
        const gateLocales = JSON.parse(match![1].replace(/'/g, '"')) as string[];
        expect(gateLocales).to.deep.equal([...QaapSupportedLocales.LOCALES]);
    });

    it('treats a stored Spanish choice as unsupported', () => {
        expect(QaapSupportedLocales.isSupported('es')).to.equal(false);
        expect(QaapSupportedLocales.isSupported('en')).to.equal(true);
        expect(QaapSupportedLocales.isSupported(undefined)).to.equal(false);
    });

    it('re-enables a language with one list entry', () => {
        const locales = ['en', 'es'];
        expect(QaapSupportedLocales.isLocalizationEnabled(locales)).to.equal(true);
        expect(QaapSupportedLocales.isSupported('ES', locales)).to.equal(true);
        expect(QaapSupportedLocales.isSupported('pt-br', locales)).to.equal(false);
        expect(QaapSupportedLocales.isLocalizationEnabled(['en', 'en-gb'])).to.equal(false);
    });
});
