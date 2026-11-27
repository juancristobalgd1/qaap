// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';

const landingHtmlPath = path.resolve(__dirname, '../../resources/landing/index.html');

describe('landing pricing markup and price ticker', () => {
    const html = fs.readFileSync(landingHtmlPath, 'utf8');

    it('declares Starter ($4.99 / month) and Pro ($12 / month) plan prices', () => {
        expect(html).to.contain('<div class="price">$4.99<small> / month</small></div>');
        expect(html).to.contain('<div class="price">$12<small> / month</small></div>');
    });

    it('attaches only one price-ticker observer so a second ticker cannot overwrite the target with $0', () => {
        const priceQueries = html.match(/querySelectorAll\(['"]\.plan \.price['"]\)/g) ?? [];
        expect(priceQueries).to.have.length(1);
        expect(html).to.not.contain('/* Number ticker: plan prices count up');
    });
});
