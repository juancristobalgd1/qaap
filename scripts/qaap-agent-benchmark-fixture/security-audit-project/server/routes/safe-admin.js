export async function tenantExportRoute(request, reply) {
    if (!request.user.roles.includes('platform-admin')) {
        return reply.code(403).send({ error: 'Forbidden' });
    }
    const tenantId = String(request.query.tenantId ?? '');
    if (!request.user.tenantIds.includes(tenantId)) {
        return reply.code(403).send({ error: 'Forbidden' });
    }
    return reply.send(await request.server.tenantStore.export(tenantId));
}
