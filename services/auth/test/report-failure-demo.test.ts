describe("temporary coverage report failure demo", () => {
  it("fails intentionally so CI report failure output can be inspected", () => {
    expect({
      expectedReportBehaviour: "failure details appear in COMBINED-CI-REPORT.md",
      removeAfterChecking: "services/auth/test/report-failure-demo.test.ts",
    }).toEqual({
      expectedReportBehaviour: "this intentionally does not match",
      removeAfterChecking: "services/auth/test/report-failure-demo.test.ts",
    });
  });
});
