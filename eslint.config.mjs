import globals from 'globals';

const sharedGlobals = {
  ...globals.browser,
  ...globals.node,
  ...globals.serviceworker,
};

export default [
  {
    ignores: [
      'node_modules/**',
      'output/**',
      'coverage/**',
      'styles.css',
    ],
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: sharedGlobals,
    },
    rules: {
      'no-constant-binary-expression': 'error',
      'no-unreachable': 'error',
      'no-undef': 'error',
    },
  },
];
