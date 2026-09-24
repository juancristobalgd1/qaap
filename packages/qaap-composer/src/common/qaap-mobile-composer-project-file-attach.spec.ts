// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveComposerProjectFileAttachment } from './qaap-mobile-composer-project-file-attach';

const FILE_VARIABLE_STUB = {
    id: 'file-provider',
    name: 'file',
    description: 'file',
};

describe('qaap-mobile-composer-project-file-attach', () => {

    it('resolveComposerProjectFileAttachment uses the file variable argument picker', async () => {
        const variableService = {
            getArgumentPicker: async (name: string) => {
                expect(name).to.equal('file');
                return async () => 'src/index.ts';
            },
        };
        const resolved = await resolveComposerProjectFileAttachment(variableService as never, FILE_VARIABLE_STUB);
        expect(resolved).to.deep.equal({
            variable: FILE_VARIABLE_STUB,
            arg: 'src/index.ts',
        });
    });

    it('resolveComposerProjectFileAttachment returns undefined when picker is cancelled', async () => {
        const variableService = {
            getArgumentPicker: async () => async () => undefined,
        };
        const resolved = await resolveComposerProjectFileAttachment(variableService as never, FILE_VARIABLE_STUB);
        expect(resolved).to.equal(undefined);
    });
});
