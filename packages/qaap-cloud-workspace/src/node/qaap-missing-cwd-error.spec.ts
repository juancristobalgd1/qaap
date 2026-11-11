// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { qaapMissingCwdError } from './qaap-missing-cwd-error';

describe('qaapMissingCwdError', () => {

    let scratch: string;

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-missing-cwd-'));
    });

    afterEach(() => {
        fs.rmSync(scratch, { recursive: true, force: true });
    });

    const NO_FOLDER = 'This task has no project folder. Open the project again from its folder and retry.';

    it('reports no project folder when cwd is undefined', () => {
        expect(qaapMissingCwdError(undefined).message).to.equal(NO_FOLDER);
    });

    it('reports no project folder when cwd is empty or whitespace', () => {
        expect(qaapMissingCwdError('').message).to.equal(NO_FOLDER);
        expect(qaapMissingCwdError('   ').message).to.equal(NO_FOLDER);
    });

    it('reports no project folder when cwd is relative', () => {
        expect(qaapMissingCwdError('relative/project').message).to.equal(NO_FOLDER);
    });

    it('reports the missing folder with its path when cwd is absolute but does not exist', () => {
        const missing = path.join(scratch, 'deleted-project');
        expect(fs.existsSync(missing)).to.equal(false);
        expect(qaapMissingCwdError(missing).message).to.equal(
            `The project folder no longer exists: ${missing}. It may have been moved or deleted — open the project again from its current folder.`
        );
    });

    it('returns an Error instance', () => {
        expect(qaapMissingCwdError(undefined)).to.be.instanceOf(Error);
    });
});
