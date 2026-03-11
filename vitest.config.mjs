import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reportsDirectory: './output/coverage',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'functions/api/**/*.js',
        'src/shared/**/*.js',
      ],
    },
  },
});
