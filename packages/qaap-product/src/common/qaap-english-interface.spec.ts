// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('Qaap English interface bootstrap', () => {

    it('forces English before the frontend bundle loads', () => {
        const gate = fs.readFileSync(
            path.resolve(__dirname, '../../resources/qaap-login-gate.js'),
            'utf8',
        );

        const localeWrite = gate.indexOf("window.localStorage.setItem('localeId', 'en')");
        const bundleLoad = gate.indexOf("script.src = './bundle.js'");
        expect(localeWrite).to.be.greaterThan(-1);
        expect(bundleLoad).to.be.greaterThan(localeWrite);
        expect(gate).to.include("document.documentElement.setAttribute('lang', 'en')");
        expect(gate).to.include('Sign in with GitHub');
        expect(gate).to.include('href="/legal/terms.html"');
        expect(gate).to.include('href="/legal/privacy.html"');
        expect(gate).to.not.include('Iniciar con GitHub');
        expect(gate).to.not.include('Reintentar');
    });
});
