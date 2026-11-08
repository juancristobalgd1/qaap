// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isQaapNewProjectDialogOpen, QaapNewProjectDialog } from './qaap-new-project-dialog';

interface DialogFields {
    readonly nameInput: HTMLInputElement;
    readonly privateRadio: HTMLInputElement | undefined;
}

describe('QaapNewProjectDialog', () => {
    it('reports no open dialog before one is shown', () => {
        expect(isQaapNewProjectDialogOpen()).to.equal(false);
    });

    it('returns a trimmed name and a local project is never public', () => {
        const dialog = new QaapNewProjectDialog({ kind: 'local' });
        (dialog as unknown as DialogFields).nameInput.value = '  my-app  ';
        expect(dialog.value).to.deep.equal({ name: 'my-app', private: true });
    });

    it('defaults a GitHub repository to private and shows the owner', () => {
        const dialog = new QaapNewProjectDialog({ kind: 'github', owner: 'octo' });
        const fields = dialog as unknown as DialogFields;
        expect(fields.privateRadio?.checked).to.equal(true);
        expect(dialog.node.textContent).to.contain('octo');
        fields.nameInput.value = 'repo';
        expect(dialog.value).to.deep.equal({ name: 'repo', private: true });
    });

    it('lets the user pick a public GitHub repository', () => {
        const dialog = new QaapNewProjectDialog({ kind: 'github', owner: 'octo' });
        const fields = dialog as unknown as DialogFields;
        fields.nameInput.value = 'repo';
        if (fields.privateRadio) {
            const publicRadio = fields.privateRadio.parentElement?.parentElement?.querySelectorAll<HTMLInputElement>('input[type=radio]')[1];
            if (publicRadio) {
                publicRadio.checked = true;
            }
        }
        expect(dialog.value.private).to.equal(false);
    });
});
