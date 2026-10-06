// *****************************************************************************
// Copyright (C) 2026 Qaap and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as vm from 'vm';
import { FrontendGenerator } from './frontend-generator';

class TestFrontendGenerator extends FrontendGenerator {
    registrationScript(): string {
        return this.compileServiceWorkerRegistration();
    }
}

interface RegistrationPage {
    reloads: number;
    fireControllerChange(): void;
}

function loadRegistrationScript(initialController: object | undefined): RegistrationPage {
    const generator = Object.create(TestFrontendGenerator.prototype) as TestFrontendGenerator;
    const html = generator.registrationScript();
    const js = html.replace(/^\s*<script[^>]*>/, '').replace(/<\/script>\s*$/, '');
    const listeners: Array<() => void> = [];
    const page: RegistrationPage = {
        reloads: 0,
        fireControllerChange: () => listeners.forEach(listener => listener())
    };
    const serviceWorker = {
        controller: initialController,
        register: () => new Promise(() => { /* registration stays pending */ }),
        addEventListener: (type: string, listener: () => void) => {
            if (type === 'controllerchange') {
                listeners.push(listener);
            }
        }
    };
    vm.runInNewContext(js, {
        navigator: { serviceWorker },
        document: { readyState: 'complete', addEventListener: () => { } },
        window: { location: { search: '' } },
        location: { reload: () => { page.reloads++; } },
        setInterval: () => 0
    });
    return page;
}

describe('FrontendGenerator service worker registration', () => {

    it('does not reload a page that no service worker controlled yet (first install claims it)', () => {
        // clients.claim() on the first install fires controllerchange. Reloading there starts the
        // frontend twice ("loading modules..." twice) on every fresh profile.
        const page = loadRegistrationScript(undefined);
        page.fireControllerChange();
        expect(page.reloads).to.equal(0);
    });

    it('reloads once when a new service worker replaces the one that controlled the page', () => {
        const page = loadRegistrationScript({});
        page.fireControllerChange();
        page.fireControllerChange();
        expect(page.reloads).to.equal(1);
    });
});
