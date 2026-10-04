// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    createQaapTenantBackendAssertion,
    QAAP_TENANT_BACKEND_ASSERTION_HEADER,
    QAAP_TENANT_BACKEND_MODE_ENV,
    QAAP_TENANT_BACKEND_SECRET_ENV,
    QAAP_TENANT_LOGIN_ENV,
} from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { QaapGitCredentialCli, QaapGitCredentialCliIo } from './qaap-git-credential-cli';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import {
    QAAP_GIT_CREDENTIAL_FILE_ENV,
    QAAP_GIT_CREDENTIAL_TTL_ENV,
    QaapGitCredentialFile,
    QaapTenantGitCredential,
} from './qaap-tenant-git-credential';

describe('QaapTenantGitCredential (git push / gh inside a tenant project)', () => {
    const envKeys = [QAAP_GIT_CREDENTIAL_FILE_ENV, QAAP_GIT_CREDENTIAL_TTL_ENV, QAAP_TENANT_BACKEND_MODE_ENV,
        QAAP_TENANT_BACKEND_SECRET_ENV, QAAP_TENANT_LOGIN_ENV] as const;
    const saved: Partial<Record<string, string>> = {};
    let dir: string;
    let file: string;
    let credential: QaapTenantGitCredential;

    const io = (stdin: string, now: number, env: NodeJS.ProcessEnv = process.env): QaapGitCredentialCliIo & { out: string; err: string } => {
        const result = {
            stdin, env, now, out: '', err: '',
            writeStdout: (text: string) => { result.out += text; },
            writeStderr: (text: string) => { result.err += text; },
        };
        return result;
    };

    beforeEach(() => {
        for (const key of envKeys) {
            saved[key] = process.env[key];
            delete process.env[key];
        }
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-git-credential-'));
        file = path.join(dir, 'cred', 'github.json');
        process.env[QAAP_GIT_CREDENTIAL_FILE_ENV] = file;
        credential = new QaapTenantGitCredential();
    });
    afterEach(() => {
        const timer = (credential as unknown as { expiryTimer?: ReturnType<typeof setTimeout> }).expiryTimer;
        if (timer) {
            clearTimeout(timer);
        }
        fs.rmSync(dir, { recursive: true, force: true });
        for (const key of envKeys) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }
    });

    it('publishes the token owner-only with a sliding one-hour expiry', () => {
        credential.remember('alice', 'gho_alice', 1_000);
        const lookup = QaapGitCredentialFile.read(file, 2_000);
        expect(lookup).to.deep.equal({ kind: 'valid', record: { login: 'alice', token: 'gho_alice', expiresAt: 1_000 + 3_600_000 } });
        if (process.platform !== 'win32') {
            expect(fs.statSync(file).mode & 0o777).to.equal(0o600);
            expect(fs.statSync(path.dirname(file)).mode & 0o777).to.equal(0o711);
        }
        expect(QaapGitCredentialFile.read(file, 1_000 + 3_600_000).kind).to.equal('expired');
        // Throttled within a minute, extended afterwards.
        credential.remember('alice', 'gho_alice', 30_000);
        expect((QaapGitCredentialFile.read(file, 2_000) as { record: { expiresAt: number } }).record.expiresAt).to.equal(3_601_000);
        credential.remember('alice', 'gho_alice', 70_000);
        expect((QaapGitCredentialFile.read(file, 2_000) as { record: { expiresAt: number } }).record.expiresAt).to.equal(3_670_000);
        // A new token (re-login) replaces the old one at once.
        credential.remember('alice', 'gho_new', 71_000);
        expect((QaapGitCredentialFile.read(file, 72_000) as { record: { token: string } }).record.token).to.equal('gho_new');
    });

    it('never writes through an entry another process planted at the credential directory', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        // An agent (another uid, same /tmp) plants a symlink where the backend publishes: a root
        // backend following it would chmod/chown the target (e.g. /etc) to the agent.
        const victim = path.join(dir, 'victim');
        fs.mkdirSync(victim, { mode: 0o755 });
        fs.symlinkSync(victim, path.dirname(file));
        credential.remember('alice', 'gho_alice', 1_000);
        expect(fs.lstatSync(path.dirname(file)).isDirectory()).to.equal(true);
        expect(fs.statSync(victim).mode & 0o777).to.equal(0o755);
        expect(fs.readdirSync(victim)).to.deep.equal([]);
        expect(QaapGitCredentialFile.read(file, 2_000).kind).to.equal('valid');
        expect(fs.readdirSync(dir).filter(name => name.startsWith('cred.stale-'))).to.have.length(1);

        // A plain file in the way is moved aside as well, never deleted or written into.
        fs.rmSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(path.dirname(file), 'planted');
        credential.remember('alice', 'gho_other', 2_000);
        expect((QaapGitCredentialFile.read(file, 3_000) as { record: { token: string } }).record.token).to.equal('gho_other');
    });

    it('publishes nothing when disabled', () => {
        process.env[QAAP_GIT_CREDENTIAL_TTL_ENV] = 'off';
        credential.remember('alice', 'gho_alice', 1_000);
        expect(fs.existsSync(file)).to.equal(false);
        expect(QaapGitCredentialFile.resolveTtlMs({ [QAAP_GIT_CREDENTIAL_TTL_ENV]: '5' })).to.equal(60_000);
        expect(QaapGitCredentialFile.resolveTtlMs({ [QAAP_GIT_CREDENTIAL_TTL_ENV]: String(48 * 3_600_000) })).to.equal(12 * 3_600_000);
    });

    it('answers git only for https://github.com, and not after expiry', () => {
        credential.remember('alice', 'gho_alice', 1_000);
        const github = io('protocol=https\nhost=github.com\n\n', 2_000);
        QaapGitCredentialCli.get(github);
        expect(github.out).to.equal('username=x-access-token\npassword=gho_alice\n');

        for (const stdin of ['protocol=https\nhost=gitlab.com\n', 'protocol=http\nhost=github.com\n', 'protocol=https\nhost=github.com.evil.test\n']) {
            const other = io(stdin, 2_000);
            QaapGitCredentialCli.get(other);
            expect(other.out, stdin).to.equal('');
        }

        const expired = io('protocol=https\nhost=github.com\n', 1_000 + 3_600_000);
        QaapGitCredentialCli.get(expired);
        expect(expired.out).to.equal('');
        expect(expired.err).to.contain('expired');
        expect(expired.err).not.to.contain('gho_alice');
    });

    it('gives gh the token unless the user set one explicitly', () => {
        credential.remember('alice', 'gho_alice', 1_000);
        expect(QaapGitCredentialCli.ghEnvironment(io('', 2_000, { [QAAP_GIT_CREDENTIAL_FILE_ENV]: file })).GH_TOKEN).to.equal('gho_alice');
        expect(QaapGitCredentialCli.ghEnvironment(io('', 2_000, { [QAAP_GIT_CREDENTIAL_FILE_ENV]: file, GH_TOKEN: 'mine' })).GH_TOKEN).to.equal('mine');
        expect(QaapGitCredentialCli.ghEnvironment(io('', 1_000 + 3_600_000, { [QAAP_GIT_CREDENTIAL_FILE_ENV]: file })).GH_TOKEN).to.equal(undefined);
    });

    it('is fed by the tenant backend assertion of GitHub users only', () => {
        const secret = 'x'.repeat(40);
        process.env[QAAP_TENANT_BACKEND_MODE_ENV] = '1';
        process.env[QAAP_TENANT_BACKEND_SECRET_ENV] = secret;
        process.env[QAAP_TENANT_LOGIN_ENV] = 'alice';
        const guard = new QaapGithubAuthGuard();
        Object.assign(guard, { gitCredential: credential });
        const request = (provider: 'github' | 'gitlab', token: string): { headers: Record<string, string> } => ({
            headers: {
                [QAAP_TENANT_BACKEND_ASSERTION_HEADER]: createQaapTenantBackendAssertion({
                    tenantLogin: 'alice',
                    user: { provider, login: 'alice', name: 'Alice' },
                    githubAccessToken: token,
                }, secret),
            },
        });

        expect(guard.authenticate(request('gitlab', 'glpat_x')).kind).to.equal('authenticated');
        expect(fs.existsSync(file)).to.equal(false);
        expect(guard.authenticate(request('github', 'gho_alice')).kind).to.equal('authenticated');
        expect((QaapGitCredentialFile.read(file) as { record: { token: string } }).record.token).to.equal('gho_alice');
    });
});
