// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as React from '@theia/core/shared/react';
import { QAAP_LOGIN_GITHUB_SVG } from './qaap-login-icons';

export type QaapLoginProvider = 'github';

export interface QaapLoginViewProps {
    appName: string;
    loading: QaapLoginProvider | undefined;
    onSignIn: (provider: QaapLoginProvider) => void;
    status?: string;
}

function getApplicationIconUrl(): string {
    const meta = typeof document !== 'undefined'
        ? document.querySelector('meta[name="application-icon"]')
        : undefined;
    const fromMeta = meta?.getAttribute('content')?.trim();
    if (fromMeta) {
        return fromMeta;
    }
    return './media/qaap-logo.svg';
}

const GitHubIcon: React.FC = () => (
    <span className='qaap-login-btn-icon-slot' dangerouslySetInnerHTML={{ __html: QAAP_LOGIN_GITHUB_SVG }} />
);

export const QaapLoginView: React.FC<QaapLoginViewProps> = ({ appName, loading, onSignIn, status }) => (
    <div className='qaap-login-overlay' role='dialog' aria-modal={true} aria-labelledby='qaap-login-title' aria-describedby='qaap-login-description'>
        <header className='qaap-login-brand'>
            <img
                className='qaap-login-logo'
                src={getApplicationIconUrl()}
                width={64}
                height={64}
                alt=''
            />
            <h1 id='qaap-login-title' className='qaap-login-title'>{appName}</h1>
            <p id='qaap-login-description' className='qaap-login-tagline'>
                A pocket workspace for coding agents.
                <br />
                Sign in to connect your repos.
            </p>
        </header>

        <div className='qaap-login-spacer' />

        <div className='qaap-login-actions'>
            <button
                type='button'
                id='qaap-login-github'
                className={`qaap-login-btn qaap-login-btn--primary${loading === 'github' ? ' qaap-login-btn--loading' : ''}`}
                disabled={loading !== undefined}
                aria-label='Continue with GitHub'
                aria-busy={loading === 'github'}
                onClick={() => onSignIn('github')}
            >
                {loading === 'github' ? (
                    <span className='qaap-login-btn-icon-slot'>
                        <span className='qaap-login-spinner' aria-hidden={true} />
                    </span>
                ) : (
                    <GitHubIcon />
                )}
                <span className='qaap-login-btn-label'>
                    {loading === 'github' ? 'Authorizing…' : 'Continue with GitHub'}
                </span>
            </button>
        </div>

        <p className='qaap-login-status' role='status' aria-live='polite' aria-atomic={true}>{status ?? ''}</p>

        <footer className='qaap-login-footer'>
            By continuing you agree to the <a href='/legal/terms.html'>terms</a>
            {' '}&amp;{' '}
            <a href='/legal/privacy.html'>privacy</a>.
            <br />
            {appName} never reads your repos without permission.
        </footer>
    </div>
);
