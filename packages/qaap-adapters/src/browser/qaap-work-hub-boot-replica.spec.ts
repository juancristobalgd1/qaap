// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import {
    buildQaapWorkHubBootReplica,
    customPropertiesOf,
    isQaapBootReplicaBodyClass,
    serializeQaapBootReplicaNode,
    toQaapBootReplicaStylesheet,
    QAAP_WORK_HUB_BOOT_REPLICA_MAX_CHARS,
} from './qaap-work-hub-boot-replica';

disableImportJSDOM();

describe('qaap-work-hub-boot-replica', () => {
    let disableSuiteJSDOM: () => void;
    before(() => { disableSuiteJSDOM = enableJSDOM(); });
    after(() => disableSuiteJSDOM());

    function element(html: string): Element {
        const host = document.createElement('div');
        host.innerHTML = html;
        return host.firstElementChild!;
    }

    describe('serializeQaapBootReplicaNode', () => {
        it('records element names, presentational attributes and text', () => {
            const node = element('<header class="h" role="banner" data-surface="x" aria-label="Top"><span title="t">wsvite</span></header>');
            expect(serializeQaapBootReplicaNode(node)).to.deep.equal(
                ['header', { class: 'h', role: 'banner', 'data-surface': 'x', 'aria-label': 'Top' }, ['span', { title: 't' }, 'wsvite']]);
        });

        it('drops scripts, styles, frames, handlers, links and unsafe inline styles', () => {
            const node = element('<div onclick="x()" style="background:url(https://evil.example)">'
                + '<script>x()</script><style>*{}</style><iframe src="https://evil.example"></iframe>'
                + '<a href="https://evil.example" class="a">ok</a><b style="color: red">bold</b></div>');
            expect(serializeQaapBootReplicaNode(node)).to.deep.equal(
                ['div', 0, ['a', { class: 'a' }, 'ok'], ['b', { style: 'color: red' }, 'bold']]);
        });

        it('keeps SVG geometry', () => {
            const node = element('<svg viewBox="0 0 24 24" class="icon"><path d="M4 5h16" stroke-width="2"></path></svg>');
            expect(serializeQaapBootReplicaNode(node)).to.deep.equal(
                ['svg', { viewBox: '0 0 24 24', class: 'icon' }, ['path', { d: 'M4 5h16', 'stroke-width': '2' }]]);
        });

        it('never records form values', () => {
            const node = element('<textarea placeholder="Delegate a task">secret draft</textarea>') as HTMLTextAreaElement;
            node.value = 'typed secret';
            const serialized = JSON.stringify(serializeQaapBootReplicaNode(node));
            expect(serialized).not.to.contain('typed secret');
        });
    });

    describe('helpers', () => {
        it('accepts only same-origin bundle and chunk stylesheets, as relative paths', () => {
            const origin = 'https://qaap.example';
            expect(toQaapBootReplicaStylesheet('./bundle.css?qaap-build=b1', origin)).to.equal('./bundle.css?qaap-build=b1');
            expect(toQaapBootReplicaStylesheet('https://qaap.example/chunk-AB12CD34.css', origin)).to.equal('./chunk-AB12CD34.css');
            expect(toQaapBootReplicaStylesheet('https://evil.example/bundle.css', origin)).to.equal(undefined);
            expect(toQaapBootReplicaStylesheet('./theme.css', origin)).to.equal(undefined);
        });

        it('keeps only custom properties of the root style', () => {
            expect(customPropertiesOf('--theia-foreground: #111; color: red; --x: url(https://evil.example)'))
                .to.equal('--theia-foreground: #111');
        });

        it('allows only theme, Work Hub chrome and OS body classes', () => {
            expect(['qaap-theme-dark', 'theia-mobile-mod-workhub-composer-header', 'linux'].every(isQaapBootReplicaBodyClass)).to.equal(true);
            expect(['theia-mobile-mod-sessions-sidebar-open', 'monaco-workbench', 'vs'].some(isQaapBootReplicaBodyClass)).to.equal(false);
        });
    });

    describe('buildQaapWorkHubBootReplica', () => {
        it('records the panel with its stylesheets, theme variables and body / shell classes', () => {
            document.head.innerHTML = '<link rel="stylesheet" href="./bundle.css"><link rel="stylesheet" href="https://evil.example/x.css">';
            document.documentElement.setAttribute('style', '--theia-foreground: #111; color: red');
            document.body.className = 'qaap-theme-light linux vs';
            const shell = element('<div id="theia-app-shell" class="lm-Widget theia-ApplicationShell"></div>');
            const panel = element('<div class="theia-mobile-projects">wsvite</div>');
            const replica = buildQaapWorkHubBootReplica({ panel, shell, login: 'octocat', build: './bundle.css', origin: window.location.origin, document }, 1000)!;
            expect(replica).to.deep.include({ v: 1, savedAt: 1000, login: 'octocat', build: './bundle.css', stylesheets: ['./bundle.css'] });
            expect(replica.rootStyle).to.equal('--theia-foreground: #111');
            expect(replica.bodyClasses).to.deep.equal(['qaap-theme-light', 'linux']);
            expect(replica.shellClasses).to.deep.equal(['lm-Widget', 'theia-ApplicationShell']);
            expect(replica.tree).to.deep.equal(['div', { class: 'theia-mobile-projects' }, 'wsvite']);
        });

        it('records nothing when the Work Hub is too large', () => {
            const panel = element(`<div>${'x'.repeat(QAAP_WORK_HUB_BOOT_REPLICA_MAX_CHARS)}</div>`);
            expect(buildQaapWorkHubBootReplica({ panel, shell: null, login: 'octocat', build: '', origin: window.location.origin, document })).to.equal(undefined);
        });
    });
});
