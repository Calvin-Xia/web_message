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
      'docs/swagger/swagger-ui-bundle.js',
      'docs/swagger/swagger-ui-standalone-preset.js',
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
