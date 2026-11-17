// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import URI from '@theia/core/lib/common/uri';
import type { MobileProjectsServiceContext } from './mobile-projects-service-context';

describe('openLocalProjectExtracted', () => {
    let disableJSDOM: (() => void) | undefined;
    let openLocalProjectExtracted: (ctx: MobileProjectsServiceContext) => Promise<unknown>;

    before(() => {
        disableJSDOM = enableJSDOM();
        openLocalProjectExtracted = require('./mobile-projects-service-render').openLocalProjectExtracted;
    });

    after(() => disableJSDOM?.());

    function createContext(options: { desktop: boolean; picked?: URI | undefined; pickError?: Error }): {
        ctx: MobileProjectsServiceContext;
        showOpenDialog: sinon.SinonStub;
        register: sinon.SinonStub;
        open: sinon.SinonStub;
        error: sinon.SinonStub;
        loadProjects: sinon.SinonStub;
    } {
        const showOpenDialog = options.pickError
            ? sinon.stub().rejects(options.pickError)
            : sinon.stub().resolves(options.picked);
        const register = sinon.stub();
        const open = sinon.stub().resolves(true);
        const error = sinon.stub().resolves(undefined);
        const loadProjects = sinon.stub().resolves([]);
        const ctx = {
            isDesktop: () => options.desktop,
            fileDialogService: { showOpenDialog },
            registerLocalWorkspaceProject: register,
            openWorkspaceUri: open,
            loadProjects,
            messageService: { error },
        } as unknown as MobileProjectsServiceContext;
        return { ctx, showOpenDialog, register, open, error, loadProjects };
    }

    it('does nothing outside the desktop app', async () => {
        const { ctx, showOpenDialog, register, open } = createContext({ desktop: false, picked: new URI('file:///Users/jc/app') });
        const result = await openLocalProjectExtracted(ctx);
        expect(result).to.equal(undefined);
        expect(showOpenDialog.called).to.equal(false);
        expect(register.called).to.equal(false);
        expect(open.called).to.equal(false);
    });

    it('does not open anything when the picker is cancelled', async () => {
        const { ctx, register, open, loadProjects } = createContext({ desktop: true, picked: undefined });
        const result = await openLocalProjectExtracted(ctx);
        expect(result).to.equal(undefined);
        expect(register.called).to.equal(false);
        expect(open.called).to.equal(false);
        expect(loadProjects.called).to.equal(false);
    });

    it('asks for a folder only and opens the chosen folder through the existing project path', async () => {
        const folder = new URI('file:///Users/jc/code/my-app');
        const { ctx, showOpenDialog, register, open, loadProjects } = createContext({ desktop: true, picked: folder });
        const result = await openLocalProjectExtracted(ctx);
        expect(showOpenDialog.calledOnce).to.equal(true);
        const props = showOpenDialog.firstCall.args[0];
        expect(props.canSelectFolders).to.equal(true);
        expect(props.canSelectFiles).to.equal(false);
        expect(props.canSelectMany).to.equal(false);
        expect(register.calledOnceWithExactly('my-app', folder)).to.equal(true);
        expect(open.calledOnceWithExactly(folder)).to.equal(true);
        expect(loadProjects.calledOnce).to.equal(true);
        expect(result).to.deep.equal([]);
    });

    it('shows a dialog failure to the user instead of swallowing it', async () => {
        const { ctx, error, register, open } = createContext({ desktop: true, pickError: new Error('Dialog unavailable') });
        const result = await openLocalProjectExtracted(ctx);
        expect(result).to.equal(undefined);
        expect(error.calledOnceWithExactly('Dialog unavailable')).to.equal(true);
        expect(register.called).to.equal(false);
        expect(open.called).to.equal(false);
    });
});
