'use strict';

const { expect } = require('chai');
const { JSDOM } = require('jsdom');
const { patchIndexForFreshAssets } = require('./qaap-frontend-asset-policy.cjs');

const MOBILE_QUERY = '(max-width: 767px), (pointer: coarse)';

function parseIndex(html, mobile) {
    return new JSDOM(html, {
        runScripts: 'dangerously',
        beforeParse(window) {
            window.matchMedia = query => ({ matches: mobile && query === MOBILE_QUERY });
        },
    });
}

describe('Qaap frontend asset policy', () => {
    const source = [
        '<!doctype html><html><head>',
        '<link rel="stylesheet" href="./bundle.css">',
        '<link href="./bundle.js" rel="modulepreload">',
        '</head><body><script src="./qaap-login-gate.js"></script></body></html>',
    ].join('');

    it('does not expose IDE JS or CSS to an unauthenticated phone document', () => {
        const html = patchIndexForFreshAssets(source, 'test-build', {
            javascript: './bundle-A1A1A1A1A1A1.js',
            stylesheet: './bundle-B2B2B2B2B2B2.css',
        });
        const dom = parseIndex(html, true);
        try {
            expect(dom.window.document.querySelector('meta[name="qaap-bundle-css"]')?.getAttribute('content'))
                .to.equal('./bundle-B2B2B2B2B2B2.css');
            expect(dom.window.document.querySelector('meta[name="qaap-bundle-js"]')?.getAttribute('content'))
                .to.equal('./bundle-A1A1A1A1A1A1.js');
            expect(dom.window.document.querySelectorAll('link[href*="bundle.css"]')).to.have.length(0);
            expect(dom.window.document.querySelectorAll('link[href*="bundle.js"]')).to.have.length(0);
            expect(dom.window.document.querySelectorAll('link[rel~="modulepreload"]')).to.have.length(0);
            expect(dom.window.document.querySelector('script[src*="qaap-login-gate.js"]')?.getAttribute('src'))
                .to.equal('./qaap-login-gate.js?qaap-build=test-build');
        } finally {
            dom.window.close();
        }
    });

    it('keeps the hashed desktop stylesheet and modulepreload while the gate controls bundle JS', () => {
        const html = patchIndexForFreshAssets(source, 'desktop-build', {
            javascript: './bundle-A1A1A1A1A1A1.js',
            stylesheet: './bundle-B2B2B2B2B2B2.css',
        });
        const dom = parseIndex(html, false);
        try {
            const stylesheet = dom.window.document.querySelector('link[href*="bundle-"]');
            expect(stylesheet?.getAttribute('href')).to.equal('./bundle-B2B2B2B2B2B2.css');
            expect(dom.window.document.querySelectorAll('link[href*="bundle-"]')).to.have.length(2);
            const bundlePreload = dom.window.document.querySelector('link[rel~="modulepreload"][href*="bundle-"]');
            expect(bundlePreload?.getAttribute('href')).to.equal('./bundle-A1A1A1A1A1A1.js');
            expect(dom.window.document.querySelectorAll('link[rel~="modulepreload"]')).to.have.length(1);
        } finally {
            dom.window.close();
        }
    });

    it('refreshes entry hash metadata idempotently when the static sync runs again', () => {
        const first = patchIndexForFreshAssets(source, 'first-build', {
            javascript: './bundle-111111111111.js',
            stylesheet: './bundle-222222222222.css',
        });
        const second = patchIndexForFreshAssets(first, 'second-build', {
            javascript: './bundle-333333333333.js',
            stylesheet: './bundle-444444444444.css',
        });
        const dom = parseIndex(second, true);
        try {
            expect(dom.window.document.querySelectorAll('meta[name="qaap-bundle-js"]')).to.have.length(1);
            expect(dom.window.document.querySelector('meta[name="qaap-bundle-css"]')?.getAttribute('content'))
                .to.equal('./bundle-444444444444.css');
            expect(dom.window.document.querySelector('meta[name="qaap-bundle-js"]')?.getAttribute('content'))
                .to.equal('./bundle-333333333333.js');
            expect((second.match(/data-qaap-desktop-asset=/g) || []).length).to.equal(2);
            expect(second).not.to.match(/bundle-(111111111111|222222222222)/);
        } finally {
            dom.window.close();
        }
    });
});
