// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveQaapFileIconClasses, setQaapFileThemeIconResolver } from './qaap-file-theme-icon';

describe('resolveQaapFileIconClasses', () => {

    afterEach(() => setQaapFileThemeIconResolver(undefined));

    it('uses the file-icon theme when it resolves the path', () => {
        setQaapFileThemeIconResolver(path => path.endsWith('.md') ? 'book-icon medium-blue theia-file-icons-js' : undefined);
        expect(resolveQaapFileIconClasses('docs/README.md')).to.equal('book-icon medium-blue theia-file-icons-js file-icon');
    });

    it('falls back to the extension codicon without a theme, or when the theme throws', () => {
        expect(resolveQaapFileIconClasses('src/app.ts')).to.match(/^codicon codicon-/);
        setQaapFileThemeIconResolver(() => { throw new Error('no theme'); });
        expect(resolveQaapFileIconClasses('src/app.ts')).to.match(/^codicon codicon-/);
    });
});
