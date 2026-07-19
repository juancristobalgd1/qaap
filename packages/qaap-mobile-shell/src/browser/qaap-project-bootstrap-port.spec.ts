// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import {
    getImplicitDevPort,
    isReservedIdePort,
    pickAlternateDevPort,
    pickNextDevPort,
    resolveBootstrapDevPort,
    wrapDevCommandForPort,
} from './qaap-project-bootstrap-port';

describe('qaap-project-bootstrap-port', () => {

    it('pickAlternateDevPort prefers 3001 when framework defaults to 3000', () => {
        expect(pickAlternateDevPort(3000, 3000)).to.equal(3001);
    });

    it('resolveBootstrapDevPort shifts off the IDE listener', () => {
        expect(resolveBootstrapDevPort(3000, 3000)).to.equal(3001);
        expect(resolveBootstrapDevPort(5173, 3000)).to.equal(5173);
        expect(resolveBootstrapDevPort(3000, 3001)).to.equal(3000);
    });

    it('isReservedIdePort treats matching IDE port as reserved', () => {
        expect(isReservedIdePort(3000, 3000)).to.equal(true);
        expect(isReservedIdePort(3000, undefined)).to.equal(true);
        expect(isReservedIdePort(3000, 3001)).to.equal(false);
        expect(isReservedIdePort(3001, 3000)).to.equal(false);
    });

    it('resolveBootstrapDevPort shifts Next off :3000 even without browser ide port', () => {
        expect(resolveBootstrapDevPort(3000, undefined)).to.equal(3001);
    });

    it('wrapDevCommandForPort uses PORT= for CRA-style stacks', () => {
        const command = wrapDevCommandForPort('npm run dev', 3001, 'node-cra');
        expect(command).to.include('QAAP_PREVIEW_PORT=3001 PORT=3001');
        expect(command).to.include('--import=data:text/javascript,process.env.PORT%3Dprocess.env.QAAP_PREVIEW_PORT');
        expect(command).to.match(/npm run dev$/);
    });

    it('wrapDevCommandForPort sets PORT and --port for Vite (overrides Docker IDE PORT)', () => {
        const command = wrapDevCommandForPort('npm run dev', 5174, 'node-vite');
        expect(command).to.include('QAAP_PREVIEW_PORT=5174 PORT=5174');
        expect(command).to.match(/npm run dev -- --port 5174$/);
    });

    it('getImplicitDevPort defaults generic Node apps to 3000', () => {
        expect(getImplicitDevPort('node-generic')).to.equal(3000);
        expect(getImplicitDevPort('node-vite')).to.equal(5173);
    });

    it('wrapDevCommandForPort passes -p to Next after PORT=', () => {
        expect(wrapDevCommandForPort('npm run dev', 3001, 'node-next')).to.match(/npm run dev -- -p 3001$/);
    });

    it('forces the allocated port when an npm script overwrites PORT inline', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        const command = wrapDevCommandForPort(
            `PORT=8080 node -e 'process.stdout.write(process.env.PORT)'`,
            8081,
            'node-generic',
        );
        expect(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })).to.equal('8081');
    });

    it('pickNextDevPort advances past conflicts, prior attempts, and the IDE listener', () => {
        expect(pickNextDevPort(5173, [], 3000)).to.equal(5174);
        expect(pickNextDevPort(5173, [5174, 5175], 3000)).to.equal(5176);
        expect(pickNextDevPort(2999, [], 3000)).to.equal(3001);
    });
});
