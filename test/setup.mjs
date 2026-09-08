// Pins the test process to UTC so date fixtures mean the same thing on every
// developer machine and in CI. Production code never depends on the process
// timezone (see src/dateRange.js), but fixtures written at T12:00:00Z do.
process.env.TZ = "UTC";
