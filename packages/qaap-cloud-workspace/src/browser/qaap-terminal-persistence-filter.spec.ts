// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { persistableQaapTerminals } from './qaap-terminal-persistence-filter';

describe('persistableQaapTerminals', () => {

    it('never lists the transient Work Hub terminals (chat panels, the hidden sign-in terminal)', () => {
        const listed = persistableQaapTerminals([
            { id: 'ide-1', title: { label: 'bash' } },
            { id: 'login', title: { label: 'π' }, options: { isTransient: true } },
            { id: 'chat', title: { label: 'Terminal' }, options: { isTransient: true } },
            { id: 'ide-2', title: { label: 'zsh' }, options: { isTransient: false } },
        ] as unknown as Parameters<typeof persistableQaapTerminals>[0]).map(terminal => terminal.title);
        // Was: the Pi sign-in terminal was saved and the IDE announced "Previous terminal session restored (π)".
        expect(listed).to.deep.equal(['bash', 'zsh']);
    });
});
