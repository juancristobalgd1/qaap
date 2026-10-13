// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { maskShellQuotedText, rewriteUnquotedShellText } from './qaap-shell-quoted-text';

describe('qaap-shell-quoted-text', () => {

    it('maskShellQuotedText blanks quoted segments and keeps offsets', () => {
        const command = "claude -p 'fix --yolo' --verbose";
        const masked = maskShellQuotedText(command);
        expect(masked).to.have.length(command.length);
        expect(masked).not.to.include('--yolo');
        expect(masked.indexOf('--verbose')).to.equal(command.indexOf('--verbose'));
    });

    it('maskShellQuotedText treats the shellQuote apostrophe escape as quoted text', () => {
        const masked = maskShellQuotedText("codex exec 'it'\\'' --yolo '\\''ok'");
        expect(masked.trim()).to.equal('codex exec');
    });

    it('maskShellQuotedText handles double quotes, backslash escapes and unterminated quotes', () => {
        expect(maskShellQuotedText('a "b \\" --yolo" c').replace(/\s+/g, ' ')).to.equal('a c');
        expect(maskShellQuotedText('a \\--yolo c').replace(/\s+/g, ' ')).to.equal('a -yolo c');
        expect(maskShellQuotedText("a 'never closed --yolo").trim()).to.equal('a');
    });

    it('rewriteUnquotedShellText restores quoted text byte-for-byte', () => {
        const prompt = "'fix --yolo  now\n\n  then '\\''ship'\\'' it'";
        const result = rewriteUnquotedShellText(`codex   --yolo exec ${prompt}`, unquoted =>
            unquoted.replace(/(?:^|\s)--yolo(?=\s|$)/g, ' ').replace(/\s{2,}/g, ' ').trim());
        expect(result).to.equal(`codex exec ${prompt}`);
    });

    it('rewriteUnquotedShellText lets a flag pattern consume a quoted value as one word', () => {
        const result = rewriteUnquotedShellText("qaiq --tools 'Read,Bash' -p 'hi'", unquoted =>
            unquoted.replace(/--tools\s+[^\s-][^\s]*/, '').replace(/\s{2,}/g, ' ').trim());
        expect(result).to.equal("qaiq -p 'hi'");
    });
});
