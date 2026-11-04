/** @type {import('jest').Config} */
module.exports = {
  // npm test runs Node with --experimental-vm-modules: the MongoDB driver loads 'os' via dynamic import(),
  // which Jest's sandbox rejects without it (the handshake then fails with "Missing required sub-document 'driver'").
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setupEnv.ts'],
  globalSetup: '<rootDir>/tests/globalSetup.ts',
  globalTeardown: '<rootDir>/tests/globalTeardown.ts',
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts'],
  testTimeout: 30000,
  // Avoid depending on a system watchman install.
  watchman: false,
};
