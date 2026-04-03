declare module "newman" {
  export interface NewmanRunSummary {
    run: {
      stats: {
        assertions?: { failed?: number };
        requests?: { failed?: number };
      };
    };
  }

  const newman: {
    run(
      options: Record<string, unknown>,
      callback: (err: Error | null, summary?: NewmanRunSummary) => void,
    ): void;
  };
  export default newman;
}
