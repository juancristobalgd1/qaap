import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Lovable's default dev server settings: a fixed port and every interface.
export default defineConfig({
    server: { host: '::', port: 8080 },
    plugins: [react()],
});
