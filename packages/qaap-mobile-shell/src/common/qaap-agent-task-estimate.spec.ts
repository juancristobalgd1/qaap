// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { estimateQaapAgentTask, formatQaapAgentTaskEstimate } from './qaap-agent-task-estimate';

describe('qaap-agent-task-estimate', () => {
    it('keeps short focused fixes unobtrusive', () => {
        const estimate = estimateQaapAgentTask('Corrige el color del botón de guardar.');
        expect(estimate.size).to.equal('small');
        expect(estimate.visible).to.equal(false);
    });

    it('surfaces a conservative range for multi-step implementation work', () => {
        const estimate = estimateQaapAgentTask([
            'Implementa estas mejoras en toda la aplicación:',
            '1. Rediseña la pantalla principal.',
            '2. Refactoriza los componentes compartidos.',
            '3. Añade pruebas de accesibilidad y validación visual.',
        ].join('\n'));
        expect(estimate.size).to.equal('large');
        expect(estimate.visible).to.equal(true);
        expect(formatQaapAgentTaskEstimate(estimate)).to.equal('~20k–60k tokens');
    });

    it('shows medium estimates before broader UI work', () => {
        const estimate = estimateQaapAgentTask('Implementa una nueva pantalla frontend responsive con sus componentes y pruebas.');
        expect(estimate.size).to.equal('medium');
        expect(estimate.visible).to.equal(true);
    });
});
