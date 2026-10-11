'use strict';

const { expect } = require('chai');
const vm = require('node:vm');
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

    it('refreshes hashed entry metadata idempotently and keeps desktop inline scripts valid', () => {
        // The Docker build runs copy-frontend-static twice (bundle:production + an explicit
        // run), and src-gen/frontend/index.html is patched in place, so the second pass sees
        // the escaped link inside the first pass's document.write() string.
        const generated = [
            '<!doctype html><html><head>',
            '<link rel="preload" href="./bundle.css" as="style" onload="this.onload=null;this.rel=\'stylesheet\'">',
            '<link href="./bundle.js" rel="modulepreload">',
            '<noscript><link rel="stylesheet" href="./bundle.css"></noscript>',
            '</head><body><script src="./qaap-login-gate.js"></script></body></html>',
        ].join('');
        const once = patchIndexForFreshAssets(generated, 'first-build', {
            javascript: './bundle-111111111111.js',
            stylesheet: './bundle-222222222222.css',
        });
        const twice = patchIndexForFreshAssets(once, 'second-build', {
            javascript: './bundle-333333333333.js',
            stylesheet: './bundle-444444444444.css',
        });
        for (const [, script] of twice.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
            expect(() => new vm.Script(script)).not.to.throw();
        }
        expect(twice).not.to.match(/bundle-(111111111111|222222222222)/);
        expect(twice).to.include('./bundle-333333333333.js');
        expect(twice).to.include('./bundle-444444444444.css');
        expect((twice.match(/data-qaap-desktop-asset=/g) || [])).to.have.length(3);
        const dom = parseIndex(twice, false);
        try {
            expect(dom.window.document.querySelectorAll('meta[name="qaap-bundle-js"]')).to.have.length(1);
            expect(dom.window.document.querySelector('meta[name="qaap-bundle-css"]')?.getAttribute('content'))
                .to.equal('./bundle-444444444444.css');
            expect(dom.window.document.querySelector('meta[name="qaap-bundle-js"]')?.getAttribute('content'))
                .to.equal('./bundle-333333333333.js');
        } finally {
            dom.window.close();
        }
    });
});
