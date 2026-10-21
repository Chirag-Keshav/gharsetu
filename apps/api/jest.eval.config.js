/** AI evaluation harness (`pnpm ai:eval`), separate from the test suite: no database reset. */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/eval'],
  testMatch: ['**/*.eval.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }] },
  setupFiles: ['<rootDir>/eval/env-setup.ts'],
  testTimeout: 180000,
  maxWorkers: 1,
};
