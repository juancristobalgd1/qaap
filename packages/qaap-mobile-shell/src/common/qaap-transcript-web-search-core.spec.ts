// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isTranscriptWebSearchTool,
    normalizeTranscriptWebSearchDisplayUrl,
    parseTranscriptWebSearchQuery,
    parseTranscriptWebSearchSites,
    resolveTranscriptWebSearchPayload,
} from './qaap-transcript-web-search-core';

describe('qaap-transcript-web-search-core', () => {
    describe('isTranscriptWebSearchTool', () => {
        it('matches WebSearch variants', () => {
            expect(isTranscriptWebSearchTool('WebSearch')).to.equal(true);
            expect(isTranscriptWebSearchTool('web_search')).to.equal(true);
            expect(isTranscriptWebSearchTool('WebSearchTool')).to.equal(true);
            expect(isTranscriptWebSearchTool('mcp_web_search')).to.equal(true);
        });

        it('rejects workspace search tools', () => {
            expect(isTranscriptWebSearchTool('Grep')).to.equal(false);
            expect(isTranscriptWebSearchTool('Glob')).to.equal(false);
            expect(isTranscriptWebSearchTool('search_files')).to.equal(false);
            expect(isTranscriptWebSearchTool(undefined)).to.equal(false);
        });
    });

    describe('parseTranscriptWebSearchQuery', () => {
        it('reads query from JSON args', () => {
            expect(parseTranscriptWebSearchQuery('{"query":"JWT auth"}')).to.equal('JWT auth');
            expect(parseTranscriptWebSearchQuery('{"search":"owasp"}')).to.equal('owasp');
            expect(parseTranscriptWebSearchQuery('{"q":"x"}')).to.equal('x');
        });

        it('returns empty for missing or invalid args', () => {
            expect(parseTranscriptWebSearchQuery(undefined)).to.equal('');
            expect(parseTranscriptWebSearchQuery('{}')).to.equal('');
            expect(parseTranscriptWebSearchQuery('not-json')).to.equal('');
        });
    });

    describe('parseTranscriptWebSearchSites', () => {
        it('parses JSON result arrays', () => {
            const sites = parseTranscriptWebSearchSites(JSON.stringify([
                { title: 'JWT best practices', url: 'https://auth0.com/blog/jwt-security-best-practices' },
                { title: 'JWT attacks', link: 'https://portswigger.net/web-security/jwt' },
            ]));
            expect(sites).to.have.length(2);
            expect(sites[0].title).to.equal('JWT best practices');
            expect(sites[0].url).to.equal('auth0.com/blog/jwt-security-best-practices');
            expect(sites[0].href).to.equal('https://auth0.com/blog/jwt-security-best-practices');
            expect(sites[1].url).to.equal('portswigger.net/web-security/jwt');
        });

        it('parses nested results objects', () => {
            const sites = parseTranscriptWebSearchSites(JSON.stringify({
                results: [{ title: 'OWASP', href: 'https://owasp.org/www-project-nodejs-goat' }],
            }));
            expect(sites).to.deep.equal([{
                title: 'OWASP',
                url: 'owasp.org/www-project-nodejs-goat',
                href: 'https://owasp.org/www-project-nodejs-goat',
            }]);
        });

        it('parses Claude flattened title:url pairs', () => {
            const sites = parseTranscriptWebSearchSites(
                'JWT verification best practices:https://auth0.com/blog/jwt-security-best-practices, '
                + 'JWT attacks · Web Security Academy:https://portswigger.net/web-security/jwt',
            );
            expect(sites).to.have.length(2);
            expect(sites[0].title).to.equal('JWT verification best practices');
            expect(sites[1].title).to.equal('JWT attacks · Web Security Academy');
            expect(sites[1].url).to.equal('portswigger.net/web-security/jwt');
        });

        it('parses QAIQ markdown bold title + url results', () => {
            const sites = parseTranscriptWebSearchSites([
                'Web search results for query: "noticias"',
                '',
                '**Últimas noticias en EL PAÍS** — Detenido en Salamanca… (https://elpais.com/ultimas-noticias/)',
                '**Noticias RTVE** — Temperaturas altas… (https://www.rtve.es/noticias/)',
            ].join('\n'));
            expect(sites).to.have.length(2);
            expect(sites[0].title).to.equal('Últimas noticias en EL PAÍS');
            expect(sites[0].href).to.equal('https://elpais.com/ultimas-noticias/');
            expect(sites[1].url).to.equal('www.rtve.es/noticias');
        });

        it('parses markdown link results', () => {
            const sites = parseTranscriptWebSearchSites([
                'Links:',
                '  - [JWT best practices](https://auth0.com/blog/jwt-security-best-practices): guide',
                '  - [JWT attacks](https://portswigger.net/web-security/jwt)',
            ].join('\n'));
            expect(sites).to.have.length(2);
            expect(sites[0].title).to.equal('JWT best practices');
            expect(sites[1].href).to.equal('https://portswigger.net/web-security/jwt');
        });

        it('returns empty for ok / garbage', () => {
            expect(parseTranscriptWebSearchSites('ok')).to.deep.equal([]);
            expect(parseTranscriptWebSearchSites('no urls here')).to.deep.equal([]);
            expect(parseTranscriptWebSearchSites(undefined)).to.deep.equal([]);
            expect(parseTranscriptWebSearchSites('Error: Web search is unavailable')).to.deep.equal([]);
        });
    });

    describe('resolveTranscriptWebSearchPayload', () => {
        it('marks all sites done when finished', () => {
            const payload = resolveTranscriptWebSearchPayload({
                name: 'WebSearch',
                args: '{"query":"jwt"}',
                result: 'A:https://a.example/x, B:https://b.example/y',
                finished: true,
            });
            expect(payload.query).to.equal('jwt');
            expect(payload.done).to.equal(true);
            expect(payload.sites).to.have.length(2);
            expect(payload.siteStates).to.deep.equal(['done', 'done']);
        });

        it('keeps loading state while unfinished', () => {
            const payload = resolveTranscriptWebSearchPayload({
                name: 'web_search',
                args: '{"query":"jwt"}',
                finished: false,
            });
            expect(payload.done).to.equal(false);
            expect(payload.sites).to.deep.equal([]);
            expect(payload.siteStates).to.deep.equal([]);
        });
    });

    describe('normalizeTranscriptWebSearchDisplayUrl', () => {
        it('strips scheme and trailing slash', () => {
            expect(normalizeTranscriptWebSearchDisplayUrl('https://example.com/path/')).to.equal('example.com/path');
        });
    });
});
