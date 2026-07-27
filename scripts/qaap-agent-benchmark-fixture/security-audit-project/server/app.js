import { previewRoute } from './routes/preview.js';
import { readProfileRoute, saveProfileRoute } from './routes/profile.js';
import { tenantExportRoute } from './routes/safe-admin.js';

export function registerRoutes(app) {
    app.get('/api/preview', previewRoute);
    app.post('/api/profile', { preHandler: app.requireUser }, saveProfileRoute);
    app.get('/api/profile/:userId', readProfileRoute);
    app.get('/api/admin/tenant-export', { preHandler: app.requireUser }, tenantExportRoute);
}
