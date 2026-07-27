const profileBios = new Map();

export async function saveProfileRoute(request, reply) {
    profileBios.set(request.user.id, String(request.body.bio ?? ''));
    return reply.code(204).send();
}

export async function readProfileRoute(request, reply) {
    return reply.send({
        userId: request.params.userId,
        bio: profileBios.get(request.params.userId) ?? '',
    });
}
