/** @type {import('eslint').Linter.Config} */
module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: {
            jsx: true
        }
    },
    plugins: ['@typescript-eslint', '@typescript-eslint/tslint', 'deprecation', 'no-null', 'react']
};
