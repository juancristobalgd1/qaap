// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Application } from '@theia/core/shared/express';
import { QaapExpressRouteOrder } from './qaap-express-route-order';

describe('QaapExpressRouteOrder.moveLastRouteFirst', () => {

    const appWithStack = (names: string[], key: '_router' | 'router' = '_router'): { app: Application; stack: { name: string }[] } => {
        const stack = names.map(name => ({ name }));
        return { app: { [key]: { stack } } as unknown as Application, stack };
    };

    it('puts the last layer right after Express 4 init layers', () => {
        const { app, stack } = appWithStack(['query', 'expressInit', 'jsonParser', 'other', 'webhook']);
        expect(QaapExpressRouteOrder.moveLastRouteFirst(app, 'test')).to.equal(true);
        expect(stack.map(layer => layer.name)).to.deep.equal(['query', 'expressInit', 'webhook', 'jsonParser', 'other']);
    });

    it('matches the init layer when a bundler suffixes its name', () => {
        const { app, stack } = appWithStack(['query2', 'expressInit2', 'jsonParser', 'webhook']);
        QaapExpressRouteOrder.moveLastRouteFirst(app, 'test');
        expect(stack.map(layer => layer.name)).to.deep.equal(['query2', 'expressInit2', 'webhook', 'jsonParser']);
    });

    it('puts the layer first on an Express 5 router without init layers', () => {
        const { app, stack } = appWithStack(['jsonParser', 'webhook'], 'router');
        QaapExpressRouteOrder.moveLastRouteFirst(app, 'test');
        expect(stack.map(layer => layer.name)).to.deep.equal(['webhook', 'jsonParser']);
    });

    it('reports false when the router stack is unreachable', () => {
        const warn = console.warn;
        console.warn = () => undefined;
        try {
            expect(QaapExpressRouteOrder.moveLastRouteFirst({} as unknown as Application, 'test')).to.equal(false);
        } finally {
            console.warn = warn;
        }
    });
});
