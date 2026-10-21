/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test', '<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }] },
  setupFiles: ['<rootDir>/test/env-setup.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  testTimeout: 60000,
  maxWorkers: 1,
};
