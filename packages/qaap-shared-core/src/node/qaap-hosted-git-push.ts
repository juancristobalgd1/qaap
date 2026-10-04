// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { QaapSealedGithubGit } from './qaap-sealed-github-git';

/** What the hosted Work Hub pushes: a commit of the project repository to one GitHub branch. */
export interface QaapHostedGitPushRequest {
    /** Absolute `objects` directory of the project repository (read as an alternate object store). */
    readonly objectsDirectory: string;
    /** Canonical `https://github.com/<owner>/<repo>.git`, see {@link QaapSealedGithubGit.toGithubHttpsUrl}. */
    readonly url: string;
    /** Full commit id to push. */
    readonly sha: string;
    /** Full destination ref, `refs/heads/<branch>`. */
    readonly ref: string;
    /** The signed-in user's GitHub token. Lives only in this backend and the push child's env. */
    readonly token: string;
}

/**
 * Pushes a hosted project to GitHub with the user's token without the agent uid ever being able to
 * read it: one commit, read from the project's objects, to a URL this backend built, from a sealed
 * git child (see {@link QaapSealedGithubGit}).
 */
@injectable()
export class QaapHostedGitPush extends QaapSealedGithubGit {

    async push(request: QaapHostedGitPushRequest): Promise<void> {
        this.assertValidRequest(request);
        const scratch = await this.createScratch('qaap-push-');
        try {
            await this.runGit(['init', '--bare', '--quiet', '--template=', scratch], this.baseEnv(scratch));
            await this.runGit([
                '--git-dir', scratch,
                ...this.sealedConfig(),
                ...this.credentialConfig(request.token),
                'push', '--porcelain', request.url, `${request.sha}:${request.ref}`,
            ], {
                ...this.baseEnv(scratch),
                GIT_ALTERNATE_OBJECT_DIRECTORIES: request.objectsDirectory,
                ...this.credentialEnv(request.token),
            });
        } finally {
            await this.removeScratch(scratch);
        }
    }

    protected assertValidRequest(request: QaapHostedGitPushRequest): void {
        if (!this.isAllowedUrl(request.url)) {
            throw new Error('Hosted push only targets GitHub over HTTPS.');
        }
        if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(request.sha)) {
            throw new Error('Hosted push needs a full commit id.');
        }
        // `check-ref-format` rules that matter for a refspec; `:`, `..`, control chars, `@{` and
        // spaces cannot appear, so the refspec is exactly `<sha>:<ref>`.
        if (!/^refs\/heads\/(?!-)(?!.*(?:\.\.|@\{|\/\.|\/\/|\.lock(?:\/|$)|\.$|\/$))[A-Za-z0-9._/+-]+$/.test(request.ref)) {
            throw new Error('Hosted push needs a valid branch ref.');
        }
        this.assertValidObjectsDirectory(request.objectsDirectory);
        this.assertValidToken(request.token, true);
    }
}
