export async function previewRoute(request, reply) {
    const target = request.query.url;
    const response = await fetch(target, {
        redirect: 'follow',
        signal: AbortSignal.timeout(5_000),
    });
    const body = await response.text();
    return reply.type('text/plain').send(body.slice(0, 50_000));
}
