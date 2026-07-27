import assert from 'node:assert/strict';

import { answer } from './answer.js';

assert.equal(answer, 42);
console.log('Public test passed.');
