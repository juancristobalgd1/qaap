/** @type {import('eslint').Linter.Config} */
module.exports = {
    extends: [
        '../../configs/build.eslintrc.json'
    ],
    parserOptions: {
        tsconfigRootDir: __dirname,
        project: 'tsconfig.json'
    },
    // Backlog rules are warnings until paid down; see scripts/qaap-eslint-ratchet.js.
    rules: require('../../scripts/qaap-eslint-ratchet').rules
};