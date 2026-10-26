// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('tenant egress proxy deployment policy', () => {
    const configRoot = path.resolve(__dirname, '../../../../deploy/qaap-tenant-egress');
    const allowedDomains = fs.readFileSync(path.join(configRoot, 'allowed-domains.txt'), 'utf8');
    const squidConfig = fs.readFileSync(path.join(configRoot, 'squid.conf'), 'utf8');
    const dockerfile = fs.readFileSync(path.join(configRoot, 'Dockerfile'), 'utf8');

    it('allows npm, GitHub, and supported model provider domains', () => {
        for (const domain of [
            '.npmjs.org', '.github.com', '.githubusercontent.com', '.openai.com', '.anthropic.com',
            '.googleapis.com', '.openrouter.ai', '.huggingface.co', '.nvidia.com', '.deepseek.com',
            '.groq.com', '.mistral.ai',
        ]) {
            expect(allowedDomains.split(/\s+/)).to.include(domain);
        }
        expect(allowedDomains).not.to.include('example.com');
    });

    it('allows the agent sign-in hosts used by the product', () => {
        for (const domain of [
            '.chatgpt.com', '.claude.ai', '.claude.com', '.cursor.com', '.nousresearch.com', 'accounts.google.com',
        ]) {
            expect(allowedDomains.split(/\s+/)).to.include(domain);
        }
    });

    it('denies unlisted domains, unsafe ports, and private destination addresses', () => {
        expect(squidConfig).to.include('acl allowed_domains dstdomain "/etc/squid/allowed-domains.txt"');
        expect(squidConfig).to.include('http_access deny !Safe_ports');
        expect(squidConfig).to.include('http_access deny CONNECT !SSL_ports');
        expect(squidConfig).to.include('http_access deny to_localhost');
        expect(squidConfig).not.to.include('to_linklocal');
        expect(squidConfig).to.match(/acl private_or_special_dst dst [\s\S]*169\.254\.0\.0\/16/);
        expect(squidConfig).to.include('http_access deny private_or_special_dst');
        expect(squidConfig).to.include('http_access allow allowed_domains');
        expect(squidConfig).to.include('http_access deny all');
    });

    it('runs Squid as its unprivileged package user', () => {
        expect(dockerfile).to.include('USER proxy');
        expect(dockerfile).to.include('COPY allowed-domains.txt /etc/squid/allowed-domains.txt');
        expect(dockerfile).to.include('RUN squid -k parse -f /etc/squid/squid.conf');
        expect(squidConfig).to.include('http_port 3128');
    });
});
