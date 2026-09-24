// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { FileIconInfo, getFileIcon, getFileIconClass } from './qaap-file-icon-utils';

describe('qaap-file-icon-utils', () => {

    describe('getFileIcon', () => {

        it('returns TypeScript icon for .ts/.tsx', () => {
            expect(getFileIcon('Canvas.tsx')).to.deep.equal({ icon: 'codicon-file-code', label: 'TypeScript file' });
            expect(getFileIcon('src/types.ts')).to.deep.equal({ icon: 'codicon-file-code', label: 'TypeScript file' });
        });

        it('returns JavaScript icon for .js/.jsx', () => {
            expect(getFileIcon('app.js')).to.deep.equal({ icon: 'codicon-file-code', label: 'JavaScript file' });
            expect(getFileIcon('app.jsx')).to.deep.equal({ icon: 'codicon-file-code', label: 'JavaScript file' });
        });

        it('returns JSON icon for .json', () => {
            expect(getFileIcon('data.json')).to.deep.equal({ icon: 'codicon-json', label: 'JSON file' });
        });

        it('returns Markdown icon for .md/.mdx', () => {
            expect(getFileIcon('README.md')).to.deep.equal({ icon: 'codicon-markdown', label: 'README' });
            expect(getFileIcon('guide.mdx')).to.deep.equal({ icon: 'codicon-markdown', label: 'Markdown file' });
        });

        it('returns CSS icon for .css/.scss', () => {
            expect(getFileIcon('styles.css')).to.deep.equal({ icon: 'codicon-symbol-color', label: 'CSS file' });
            expect(getFileIcon('theme.scss')).to.deep.equal({ icon: 'codicon-symbol-color', label: 'SCSS file' });
        });

        it('returns media icon for images', () => {
            expect(getFileIcon('logo.png')).to.deep.equal({ icon: 'codicon-file-media', label: 'PNG image' });
            expect(getFileIcon('photo.jpg')).to.deep.equal({ icon: 'codicon-file-media', label: 'JPEG image' });
        });

        it('returns PDF icon for .pdf', () => {
            expect(getFileIcon('doc.pdf')).to.deep.equal({ icon: 'codicon-file-pdf', label: 'PDF document' });
        });

        it('returns zip icon for archives', () => {
            expect(getFileIcon('archive.zip')).to.deep.equal({ icon: 'codicon-file-zip', label: 'ZIP archive' });
        });

        it('returns special icon for package.json', () => {
            expect(getFileIcon('package.json')).to.deep.equal({ icon: 'codicon-json', label: 'npm package' });
            expect(getFileIcon('nested/path/package.json')).to.deep.equal({ icon: 'codicon-json', label: 'npm package' });
        });

        it('returns special icon for .env files', () => {
            expect(getFileIcon('.env')).to.deep.equal({ icon: 'codicon-settings-gear', label: 'Environment file' });
            expect(getFileIcon('.env.local')).to.deep.equal({ icon: 'codicon-settings-gear', label: 'Environment file' });
            expect(getFileIcon('.env.production')).to.deep.equal({ icon: 'codicon-settings-gear', label: 'Environment file' });
        });

        it('returns special icon for .gitignore', () => {
            expect(getFileIcon('.gitignore')).to.deep.equal({ icon: 'codicon-settings-gear', label: 'Git ignore' });
        });

        it('returns default file icon for unknown extensions', () => {
            expect(getFileIcon('unknown.xyz')).to.deep.equal({ icon: 'codicon-file', label: 'File' });
        });

        it('returns default file icon for no extension', () => {
            expect(getFileIcon('Makefile')).to.deep.equal({ icon: 'codicon-file-code', label: 'Makefile' });
            expect(getFileIcon('noext')).to.deep.equal({ icon: 'codicon-file', label: 'File' });
        });

        it('handles empty string', () => {
            expect(getFileIcon('')).to.deep.equal({ icon: 'codicon-file', label: 'File' });
        });

        it('is case-insensitive for extensions', () => {
            expect(getFileIcon('App.TSX')).to.deep.equal({ icon: 'codicon-file-code', label: 'TypeScript file' });
            expect(getFileIcon('DATA.JSON')).to.deep.equal({ icon: 'codicon-json', label: 'JSON file' });
        });

        it('is case-insensitive for special filenames', () => {
            expect(getFileIcon('Package.json')).to.deep.equal({ icon: 'codicon-json', label: 'npm package' });
            expect(getFileIcon('PACKAGE.JSON')).to.deep.equal({ icon: 'codicon-json', label: 'npm package' });
        });

        it('extracts basename from full path', () => {
            expect(getFileIcon('src/components/Canvas.tsx').icon).to.equal('codicon-file-code');
            expect(getFileIcon('deep/nested/path/to/config.json').icon).to.equal('codicon-json');
        });

    });

    describe('getFileIconClass', () => {

        it('returns just the icon class', () => {
            expect(getFileIconClass('Canvas.tsx')).to.equal('codicon-file-code');
            expect(getFileIconClass('README.md')).to.equal('codicon-markdown');
            expect(getFileIconClass('unknown.xyz')).to.equal('codicon-file');
        });

    });

    describe('FileIconInfo type', () => {

        it('has icon and label fields', () => {
            const info: FileIconInfo = getFileIcon('test.ts');
            expect(info).to.have.property('icon');
            expect(info).to.have.property('label');
            expect(typeof info.icon).to.equal('string');
            expect(typeof info.label).to.equal('string');
        });

    });

});
