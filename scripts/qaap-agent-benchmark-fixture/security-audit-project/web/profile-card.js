export async function loadProfileCard(root, userId, api) {
    const response = await api.get(`/api/profile/${encodeURIComponent(userId)}`);
    root.querySelector('[data-profile-name]').textContent = response.displayName ?? '';
    root.querySelector('[data-profile-bio]').innerHTML = response.bio ?? '';
}
