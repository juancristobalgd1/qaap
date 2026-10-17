import { assert, oracle } from './_lib.mjs';

await oracle(process.argv[2], async ({ load }) => {
    const { createUser, validateUser, ValidationError } = await load('src/users.js');
    const good = { name: 'Ada', email: 'ada@example.com', age: 36 };

    assert.deepEqual(validateUser(good), { valid: true, errors: {} });
    assert.deepEqual(validateUser({ ...good, name: '   ' }).errors, { name: 'name is required' });
    assert.deepEqual(validateUser({ ...good, name: 42 }).errors, { name: 'name is required' });
    assert.deepEqual(validateUser({ ...good, name: 'x'.repeat(101) }).errors,
        { name: 'name must be at most 100 characters' });
    assert.equal(validateUser({ ...good, name: 'x'.repeat(100) }).valid, true);
    for (const email of ['', 'nope', 'a@b', '@x.io', 'a b@x.io', 'a@@x.io', undefined]) {
        assert.deepEqual(validateUser({ ...good, email }).errors, { email: 'email is invalid' }, `email ${email}`);
    }
    const ageMessage = 'age must be an integer between 13 and 120';
    for (const age of [12, 121, 36.5, '36', null, undefined, Number.NaN]) {
        assert.deepEqual(validateUser({ ...good, age }).errors, { age: ageMessage }, `age ${age}`);
    }
    assert.equal(validateUser({ ...good, age: 13 }).valid, true);
    assert.equal(validateUser({ ...good, age: 120 }).valid, true);

    const all = validateUser({});
    assert.equal(all.valid, false);
    assert.deepEqual(Object.keys(all.errors), ['name', 'email', 'age']);
    assert.deepEqual(validateUser(null), { valid: false, errors: { input: 'input must be an object' } });
    assert.deepEqual(validateUser('text').errors, { input: 'input must be an object' });

    assert.throws(() => createUser({ name: '', email: 'bad', age: 5 }), error => {
        assert.ok(error instanceof ValidationError);
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'ValidationError');
        assert.equal(error.message, 'Invalid user: name, email, age');
        assert.deepEqual(error.errors, {
            name: 'name is required',
            email: 'email is invalid',
            age: ageMessage,
        });
        return true;
    });
    assert.throws(() => createUser(undefined), ValidationError);

    const user = createUser({ name: '  Ada ', email: 'ADA@Example.com', age: 36 });
    assert.equal(user.name, 'Ada');
    assert.equal(user.email, 'ada@example.com');
});
