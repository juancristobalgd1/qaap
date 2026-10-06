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
        const html = patchIndexForFreshAssets(source, 'test-build');
        const dom = parseIndex(html, true);
        try {
            expect(dom.window.document.querySelector('meta[name="qaap-bundle-css"]')?.getAttribute('content'))
                .to.equal('./bundle.css?qaap-build=test-build');
            expect(dom.window.document.querySelectorAll('link[href*="bundle.css"]')).to.have.length(0);
            expect(dom.window.document.querySelectorAll('link[href*="bundle.js"]')).to.have.length(0);
            expect(dom.window.document.querySelectorAll('link[rel~="modulepreload"]')).to.have.length(0);
            expect(dom.window.document.querySelector('script[src*="qaap-login-gate.js"]')?.getAttribute('src'))
                .to.equal('./qaap-login-gate.js?qaap-build=test-build');
        } finally {
            dom.window.close();
        }
    });

    it('keeps the original bundle stylesheet on desktop while the gate controls bundle JS', () => {
        const html = patchIndexForFreshAssets(source, 'desktop-build');
        const dom = parseIndex(html, false);
        try {
            const stylesheet = dom.window.document.querySelector('link[href*="bundle.css"]');
            expect(stylesheet?.getAttribute('href')).to.equal('./bundle.css?qaap-build=desktop-build');
            expect(dom.window.document.querySelectorAll('link[href*="bundle.css"]')).to.have.length(1);
            const bundlePreload = dom.window.document.querySelector('link[rel~="modulepreload"][href*="bundle.js"]');
            expect(bundlePreload?.getAttribute('href')).to.equal('./bundle.js?qaap-build=desktop-build');
            expect(dom.window.document.querySelectorAll('link[href*="bundle.js"]')).to.have.length(1);
            expect(dom.window.document.querySelectorAll('link[rel~="modulepreload"]')).to.have.length(1);
        } finally {
            dom.window.close();
        }
    });
});
