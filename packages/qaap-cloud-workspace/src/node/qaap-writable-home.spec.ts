// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isQaapExistingDirectoryReadOnly, resolveQaapWritableHome } from './qaap-writable-home';

describe('resolveQaapWritableHome', () => {
    let root: string;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-writable-home-'));
    });
    afterEach(() => {
        fs.chmodSync(root, 0o700);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('keeps a writable or missing HOME', () => {
        expect(resolveQaapWritableHome(root, '/data/qaap')).to.equal(root);
        expect(resolveQaapWritableHome(path.join(root, 'missing'), '/data/qaap')).to.equal(path.join(root, 'missing'));
    });

    it('moves a read-only HOME next to the writable root', function (): void {
        if (process.platform === 'win32' || process.getuid?.() === 0) {
            // Mode bits do not restrict Windows ACLs or root.
            this.skip();
        }
        fs.chmodSync(root, 0o500);
        expect(isQaapExistingDirectoryReadOnly(root)).to.equal(true);
        expect(resolveQaapWritableHome(root, '/data/qaap')).to.equal(path.join('/data/qaap', 'home'));
    });
});
