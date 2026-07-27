import assert from 'node:assert/strict';

import { registerRoutes } from './server/app.js';
import { showNotification } from './web/safe-notification.js';

assert.equal(typeof registerRoutes, 'function');

const element = { textContent: '' };
showNotification({ querySelector: () => element }, '<b>hello</b>');
assert.equal(element.textContent, '<b>hello</b>');

console.log('Fixture smoke test passed.');
