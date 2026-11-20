// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapChangedFileStatus } from './qaap-diff-review-file-status';

describe('QaapChangedFileStatus', () => {
    it('maps git status letters to row glyphs', () => {
        const kinds = ['A', 'U', '?', 'M', 'D', 'R', 'C', 'T', ''].map(status => {
            const described = QaapChangedFileStatus.describe(status);
            return `${described.kind}:${described.letter}`;
        });
        expect(kinds).to.deep.equal([
            'added:A', 'added:A', 'added:A', 'modified:M', 'deleted:D', 'renamed:R', 'copied:C', 'modified:M', 'modified:M',
        ]);
    });

    it('reads similarity-suffixed rename statuses as renames', () => {
        expect(QaapChangedFileStatus.describe('R100').kind).to.equal('renamed');
    });

    it('provides a readable label', () => {
        expect(QaapChangedFileStatus.describe('D').label).to.equal('Deleted');
    });
});
