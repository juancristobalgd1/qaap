// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { resolveChatScrollFadeHosts, resolveChatScrollFadeState } from './qaap-chat-scroll-fade';

describe('qaap-chat-scroll-fade', () => {

    it('hides both fades when content does not scroll', () => {
        expect(resolveChatScrollFadeState(0, 100, 100)).to.deep.equal({
            showTop: false,
            showBottom: false,
        });
    });

    it('shows only the bottom fade at the top of a long thread', () => {
        expect(resolveChatScrollFadeState(0, 500, 100)).to.deep.equal({
            showTop: false,
            showBottom: true,
        });
    });

    it('shows only the top fade at the bottom of a long thread', () => {
        expect(resolveChatScrollFadeState(400, 500, 100)).to.deep.equal({
            showTop: true,
            showBottom: false,
        });
    });

    it('shows both fades in the middle of a long thread', () => {
        expect(resolveChatScrollFadeState(200, 500, 100)).to.deep.equal({
            showTop: true,
            showBottom: true,
        });
    });

    describe('resolveChatScrollFadeHosts', () => {
        let disableJSDOM: (() => void) | undefined;

        before(() => {
            disableJSDOM = enableJSDOM();
        });

        after(() => {
            disableJSDOM?.();
            disableJSDOM = undefined;
        });

        it('does not pin the bottom fade to projects-scroll on agents hub chat', () => {
            const projects = document.createElement('div');
            projects.className = 'theia-mobile-projects theia-mod-sticky-composer theia-mod-agents-hub-inline-active';
            const projectsScroll = document.createElement('div');
            projectsScroll.className = 'theia-mobile-projects-scroll';
            const inline = document.createElement('div');
            inline.className = 'theia-mobile-agents-hub-inline-transcript';
            const realChat = document.createElement('div');
            realChat.className = 'theia-mobile-agent-transcript-real-chat';
            const transcript = document.createElement('div');
            transcript.className = 'theia-mobile-agent-transcript';
            realChat.append(transcript);
            inline.append(realChat);
            projectsScroll.append(inline);
            projects.append(projectsScroll);
            document.body.append(projects);

            const hosts = resolveChatScrollFadeHosts(transcript);
            expect(hosts.top).to.equal(inline);
            expect(hosts.bottom).to.equal(realChat);
            expect(hosts.bottom).to.not.equal(projectsScroll);

            projects.remove();
        });
    });

});
