/**
 * Split `items` into pages. Pages are 1-based.
 */
export function paginate(items, page = 1, pageSize = 10) {
    const total = items.length;
    const totalPages = Math.floor(total / pageSize);
    const start = (page - 1) * pageSize;
    return {
        items: items.slice(start, start + pageSize),
        page,
        pageSize,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
    };
}
