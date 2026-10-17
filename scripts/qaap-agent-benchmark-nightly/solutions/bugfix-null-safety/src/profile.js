export function displayName(user) {
    const name = user?.profile?.name;
    if (typeof name === 'string' && name.trim()) {
        return name.trim();
    }
    const email = user?.email;
    if (typeof email === 'string' && email.split('@')[0]) {
        return email.split('@')[0];
    }
    return 'Anonymous';
}

export function formatAddress(user) {
    const address = user?.profile?.address;
    if (!address) {
        return '';
    }
    const place = [address.city, address.zip].filter(Boolean).join(' ');
    return [address.street, place].filter(Boolean).join(', ');
}

export function averageRating(reviews) {
    const ratings = (reviews ?? []).map(review => review?.rating).filter(Number.isFinite);
    return ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : 0;
}
