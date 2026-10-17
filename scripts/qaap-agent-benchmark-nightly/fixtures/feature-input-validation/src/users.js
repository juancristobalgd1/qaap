let nextId = 1;

/** Create a user record from raw input. */
export function createUser(input) {
    return {
        id: nextId++,
        name: input.name.trim(),
        email: input.email.toLowerCase(),
        age: input.age,
    };
}
