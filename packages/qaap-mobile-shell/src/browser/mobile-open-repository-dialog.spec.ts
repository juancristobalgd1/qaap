// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

const STYLE_DIR = path.join(__dirname, '..', '..', 'src', 'browser', 'style');
const BROWSER_DIR = path.join(__dirname, '..', '..', 'src', 'browser');

describe('mobile-open-repository-dialog styles', () => {

    it('is imported from the boot-critical frontend module', () => {
        const src = fs.readFileSync(
            path.join(BROWSER_DIR, 'qaap-mobile-shell-frontend-module.ts'),
            'utf8'
        );
        expect(src).to.include("import '../../src/browser/style/mobile-workbench-open-repo.css'");
    });

    it('themes tabs, filter, and create so they do not fall back to native chrome', () => {
        const css = fs.readFileSync(path.join(STYLE_DIR, 'mobile-workbench-open-repo.css'), 'utf8');
        expect(css).to.include('.theia-mobile-open-repo-tab {');
        expect(css).to.include('.theia-mobile-open-repo-filter {');
        expect(css).to.include('.theia-mobile-open-repo-create {');
        expect(css).to.match(/\.theia-mobile-open-repo-tab\s*\{[^}]*background:\s*transparent;/s);
        expect(css).to.match(/\.theia-mobile-open-repo-create\s*\{[^}]*background:\s*transparent;/s);
        expect(css).to.match(/\.theia-mobile-open-repo-filter\s*\{[^}]*background:\s*var\(--theia-input-background/s);
        expect(css).to.include('.theia-mobile-open-repo button {');
        expect(css).to.include('appearance: none');
        expect(css).to.include('display: none !important');
    });

    it('does not leave drawer styles stranded in the unloaded PR-review partial', () => {
        const css = fs.readFileSync(path.join(STYLE_DIR, 'mobile-workbench-pr-review.css'), 'utf8');
        expect(css).to.not.include('.theia-mobile-open-repo {');
        expect(css).to.not.include('.theia-mobile-open-repo-tab {');
    });
});
