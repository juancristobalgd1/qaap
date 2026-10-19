#!/usr/bin/env node
// Serves <dir>/index.html on $PORT, like `theia start` serving its built bundle.
const fs = require('fs');
const path = require('path');
const dir = path.resolve(process.argv[2] || '.');
const index = path.join(dir, 'index.html');
if (!fs.existsSync(index)) {
    console.error(`Error: Cannot find module '${path.join(dir, 'index.html')}'`);
    process.exit(1);
}
const port = Number(process.env.PORT || 4321);
require('http').createServer((req, res) => res.end(fs.readFileSync(index))).listen(port, () => console.log(`Listening on http://localhost:${port}`));
