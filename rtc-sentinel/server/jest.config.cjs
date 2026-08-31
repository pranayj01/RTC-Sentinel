module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  globals: { 'ts-jest': { useESM: true, tsconfig: 'tsconfig.json' } },
};
