module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  maxWorkers: 1,
  coverageReporters: ["text", "lcov", "html", "json-summary"],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
};
