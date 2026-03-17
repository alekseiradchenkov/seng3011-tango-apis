export function nowTimeObject() {
  return {
    timestamp: new Date().toISOString(),
    timezone: "UTC",
  };
}