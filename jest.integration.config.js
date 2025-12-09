/* eslint-env node */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/integration/**/*.test.ts'],
  globalSetup: '<rootDir>/tests/integration/setup.ts',
  globalTeardown: '<rootDir>/tests/integration/teardown.ts',
  testTimeout: 120000, // 2 minutes for integration tests
  collectCoverage: false, // Disable coverage for integration tests
};
