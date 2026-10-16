# Preview bench apps

Minimal apps for `scripts/qaap-preview-bench.mjs` (roadmap H1.2). Each one hardcodes what generated apps
often hardcode, so the bench exercises the preview supervisor's port pinning, the `/qaap-preview/<id>/`
proxy rewriting and hydration:

| App | Shape | Hardcodes |
|---|---|---|
| `lovable-vite` | React SPA on Vite, like a classic Lovable project | `server.port: 8080`, `host: '::'` in `vite.config.js` |
| `next` | Next.js app router with a client component | `next dev -p 3000` |
| `tanstack-start` | TanStack Start (SSR + hydration), like a recent Lovable project | — |

Every app renders a `data-qaap-bench="counter"` button; the bench clicks it to prove hydration.
Dependencies are not committed: `node scripts/qaap-preview-bench.mjs --install ...` installs them.
