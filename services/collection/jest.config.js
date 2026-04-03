module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  maxWorkers: 1,
  testPathIgnorePatterns: ["/node_modules/", "test/datasets.test.ts"],
  coverageReporters: ["text", "lcov", "html", "json-summary"],
  transform: {
    "^.+\\.(ts|tsx|js)$": ["ts-jest", { diagnostics: false }],
  },
};
