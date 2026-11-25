// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { getQaapTasksBackgroundContextFragment } from './qaap-tasks-background-prompt-template';

describe('Qaap background agent context', () => {
    it('tells the agent that Qaap owns the preview server so it does not start its own on another port', () => {
        const template = getQaapTasksBackgroundContextFragment().template;
        expect(template).to.contain('**Qaap owns the preview server.**');
        expect(template).to.contain('restarts it after your turn when you changed server code');
        expect(template).to.match(/Do not start your own copy of the app or a test server on another port/);
    });

    it('does not call the workspace an ephemeral sandbox, which is false on desktop', () => {
        const template = getQaapTasksBackgroundContextFragment().template;
        expect(template).not.to.contain('ephemeral');
        expect(template).to.contain('a folder on the user\'s own machine in Qaap desktop');
        expect(template).to.contain('do not change files outside the workspace');
    });
});
