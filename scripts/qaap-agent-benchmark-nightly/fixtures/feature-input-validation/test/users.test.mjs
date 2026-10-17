import assert from 'node:assert/strict';
import test from 'node:test';
import { createUser } from '../src/users.js';

test('creates a normalized user', () => {
    const user = createUser({ name: '  Ada ', email: 'ADA@Example.com', age: 36 });
    assert.equal(user.name, 'Ada');
    assert.equal(user.email, 'ada@example.com');
    assert.equal(user.age, 36);
    assert.equal(typeof user.id, 'number');
});

test('ids are unique', () => {
    const a = createUser({ name: 'A', email: 'a@x.io', age: 20 });
    const b = createUser({ name: 'B', email: 'b@x.io', age: 21 });
    assert.notEqual(a.id, b.id);
});
