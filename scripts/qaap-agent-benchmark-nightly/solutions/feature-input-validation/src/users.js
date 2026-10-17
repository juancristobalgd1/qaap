let nextId = 1;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export class ValidationError extends Error {
    constructor(errors) {
        super(`Invalid user: ${Object.keys(errors).join(', ')}`);
        this.name = 'ValidationError';
        this.errors = errors;
    }
}

export function validateUser(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        return { valid: false, errors: { input: 'input must be an object' } };
    }
    const errors = {};
    if (typeof input.name !== 'string' || input.name.trim().length === 0) {
        errors.name = 'name is required';
    } else if (input.name.trim().length > 100) {
        errors.name = 'name must be at most 100 characters';
    }
    if (typeof input.email !== 'string' || !EMAIL.test(input.email.trim())) {
        errors.email = 'email is invalid';
    }
    if (!Number.isInteger(input.age) || input.age < 13 || input.age > 120) {
        errors.age = 'age must be an integer between 13 and 120';
    }
    return { valid: Object.keys(errors).length === 0, errors };
}

export function createUser(input) {
    const { valid, errors } = validateUser(input);
    if (!valid) {
        throw new ValidationError(errors);
    }
    return {
        id: nextId++,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        age: input.age,
    };
}
