'use strict';

const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require:      'readonly',
        module:       'readonly',
        exports:      'readonly',
        __dirname:    'readonly',
        __filename:   'readonly',
        process:      'readonly',
        console:      'readonly',
        Buffer:       'readonly',
        setTimeout:   'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef':        'error',
      'no-console':      'off',
      'eqeqeq':         ['error', 'always'],
      'prefer-const':    'error',
      'no-var':          'error',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        jest:       'readonly',
        describe:   'readonly',
        test:       'readonly',
        expect:     'readonly',
        beforeAll:  'readonly',
        afterAll:   'readonly',
        beforeEach: 'readonly',
        afterEach:  'readonly',
      },
    },
  },
];
