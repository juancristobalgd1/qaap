// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QAAP_VITE_SCAFFOLD_TEMPLATE_ID,
    resolveQaapProjectScaffoldTemplate,
} from './qaap-project-scaffold-templates';

describe('qaap-project-scaffold-templates', () => {

    it('resolveQaapProjectScaffoldTemplate returns vite template by default', () => {
        const template = resolveQaapProjectScaffoldTemplate(undefined);
        expect(template?.id).to.equal(QAAP_VITE_SCAFFOLD_TEMPLATE_ID);
        expect(template?.files['package.json']).to.include('vite');
        expect(template?.files['index.html']).to.include('<!DOCTYPE html>');
    });
});
