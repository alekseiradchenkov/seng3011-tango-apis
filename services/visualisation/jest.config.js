module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  maxWorkers: 1,
  testPathIgnorePatterns: ["/node_modules/", "test/visualisation.test.ts"],

  transform: {
    "^.+\\.(ts|tsx|js)$": "ts-jest",
  },
};
