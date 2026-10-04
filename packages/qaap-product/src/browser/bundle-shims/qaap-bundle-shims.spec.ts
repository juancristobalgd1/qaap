// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fullLocales from 'date-fns/locale';
import * as shimLocales from './qaap-date-fns-locales';
import hljs = require('./qaap-highlight-common');
import { QAAP_HIGHLIGHT_LANGUAGES } from './qaap-highlight-languages';

describe('qaap bundle shims', () => {

    describe('qaap-highlight-common', () => {

        it('registers every listed language on the shared hljs instance', () => {
            expect(QAAP_HIGHLIGHT_LANGUAGES.length).to.be.greaterThan(30);
            for (const [name] of QAAP_HIGHLIGHT_LANGUAGES) {
                expect(hljs.getLanguage(name), name).to.not.equal(undefined);
            }
            expect(hljs.getLanguage('ts'), 'typescript alias').to.not.equal(undefined);
        });

        it('highlights with the legacy call the Markdown preview uses', () => {
            const html = hljs.highlight('typescript', 'const answer: number = 42;', true).value;
            expect(html).to.contain('<span class="hljs-keyword">const</span>');
        });

        it('leaves languages outside the common set unregistered, so the preview falls back to plain code', () => {
            expect(hljs.getLanguage('mathematica')).to.equal(undefined);
        });
    });

    describe('qaap-date-fns-locales', () => {

        it('exports the same locale objects as date-fns/locale', () => {
            const shim = shimLocales as unknown as Record<string, unknown>;
            const full = fullLocales as unknown as Record<string, unknown>;
            const names = Object.keys(shim).filter(name => name !== '__esModule');
            expect(names).to.include('enUS');
            for (const name of names) {
                expect(shim[name], name).to.equal(full[name]);
            }
        });

        it('covers every Theia language-pack id that is also a date-fns locale name', () => {
            // Ids of the VS Code language packs Theia can load (`nls.locale`).
            const theiaLocaleIds = ['cs', 'de', 'es', 'fr', 'hu', 'it', 'ja', 'ko', 'pl', 'pt-br', 'ru', 'tr', 'zh-cn', 'zh-tw'];
            const shim = shimLocales as unknown as Record<string, unknown>;
            const full = fullLocales as unknown as Record<string, unknown>;
            for (const id of theiaLocaleIds) {
                expect(shim[id], id).to.equal(full[id]);
            }
        });
    });
});
