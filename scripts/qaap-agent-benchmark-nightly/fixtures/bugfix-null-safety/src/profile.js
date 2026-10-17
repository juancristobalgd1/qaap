/** Human readable name for a user: the profile name, falling back to the e-mail local part. */
export function displayName(user) {
    return user.profile.name || user.email.split('@')[0];
}

/** One-line postal address: `<street>, <city> <zip>`. */
export function formatAddress(user) {
    const address = user.profile.address;
    return `${address.street}, ${address.city} ${address.zip}`;
}

/** Mean of the review ratings. */
export function averageRating(reviews) {
    return reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
}
