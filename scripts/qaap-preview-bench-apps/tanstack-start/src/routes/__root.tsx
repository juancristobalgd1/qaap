/// <reference types="vite/client" />
import type { ReactNode } from 'react';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';

export const Route = createRootRoute({
    head: () => ({ meta: [{ charSet: 'utf-8' }, { title: 'Qaap TanStack fixture' }] }),
    component: () => <Outlet />,
    shellComponent: ({ children }: { children: ReactNode }) => (
        <html><head><HeadContent /></head><body>{children}<Scripts /></body></html>
    ),
});
