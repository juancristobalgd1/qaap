// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const QAAP_VITE_SCAFFOLD_TEMPLATE_ID = 'vite-static';

export interface QaapProjectScaffoldTemplate {
    readonly id: string;
    readonly label: string;
    readonly files: Readonly<Record<string, string>>;
    readonly composerPrompt: string;
}

const VITE_PACKAGE_JSON = `{
  "name": "qaap-new-project",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5173 --strictPort",
    "build": "vite build",
    "preview": "vite preview --host 127.0.0.1 --port 4173"
  },
  "devDependencies": {
    "vite": "^6.2.0"
  }
}
`;

const VITE_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New project</title>
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body>
  <main class="hero">
    <p class="eyebrow">Qaap</p>
    <h1>Your new web app</h1>
    <p class="lead">Ask QAIQ to customize this landing page for your product.</p>
  </main>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
`;

const VITE_STYLE_CSS = `:root {
  --bg: #0f1115;
  --text: #f4f1ea;
  --accent: #c9a962;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); }
.hero { min-height: 100vh; display: grid; place-content: center; text-align: center; padding: 2rem; }
.eyebrow { letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); font-size: 0.75rem; }
h1 { font-size: clamp(2rem, 6vw, 3.5rem); margin: 1rem 0; }
.lead { opacity: 0.85; max-width: 36ch; margin: 0 auto; line-height: 1.6; }
`;

const VITE_MAIN_JS = `document.title = 'New project';
`;

export const QAAP_PROJECT_SCAFFOLD_TEMPLATES: readonly QaapProjectScaffoldTemplate[] = [
    {
        id: QAAP_VITE_SCAFFOLD_TEMPLATE_ID,
        label: 'Vite static site',
        files: {
            'package.json': VITE_PACKAGE_JSON,
            'index.html': VITE_INDEX_HTML,
            'src/style.css': VITE_STYLE_CSS,
            'src/main.js': VITE_MAIN_JS,
        },
        composerPrompt: 'Customize this Vite landing page with a modern design. Keep port 5173 for the dev server.',
    },
];

export function resolveQaapProjectScaffoldTemplate(templateId: string | undefined): QaapProjectScaffoldTemplate | undefined {
    const normalized = templateId?.trim() || QAAP_VITE_SCAFFOLD_TEMPLATE_ID;
    return QAAP_PROJECT_SCAFFOLD_TEMPLATES.find(template => template.id === normalized);
}
