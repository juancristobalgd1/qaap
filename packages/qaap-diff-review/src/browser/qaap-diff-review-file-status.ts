// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

/** Visual kind of a changed file's git status; drives the glyph letter and its theme colour. */
export type QaapChangedFileStatusKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export interface QaapChangedFileStatus {
    readonly kind: QaapChangedFileStatusKind;
    /** One-letter glyph shown in the row (A, M, D, R, C). */
    readonly letter: string;
    /** Localized, screen-reader friendly status name. */
    readonly label: string;
}

export namespace QaapChangedFileStatus {

    /**
     * Maps the single-letter status of `/changes` (`git status` / `git diff --name-status`) to a row glyph.
     * Untracked files (`U`, `?`) read as added; type changes and unknown letters read as modified.
     */
    export function describe(status: string): QaapChangedFileStatus {
        switch (status.charAt(0).toUpperCase()) {
            case 'A':
            case 'U':
            case '?':
                return { kind: 'added', letter: 'A', label: nls.localize('qaap/diff/statusAdded', 'Added') };
            case 'D':
                return { kind: 'deleted', letter: 'D', label: nls.localizeByDefault('Deleted') };
            case 'R':
                return { kind: 'renamed', letter: 'R', label: nls.localize('qaap/diff/statusRenamed', 'Renamed') };
            case 'C':
                return { kind: 'copied', letter: 'C', label: nls.localize('qaap/diff/statusCopied', 'Copied') };
            default:
                return { kind: 'modified', letter: 'M', label: nls.localizeByDefault('Modified') };
        }
    }
}
