// Production code never reads the process timezone: dates resolve in the
// target city's zone (src/dateRange.js, src/cities.js). Fixtures are a
// different matter - a date literal written at T12:00:00Z means a different
// calendar day depending on where the process thinks it is.
//
// So: default to UTC for a deterministic local `npm test`, but honor an
// explicitly exported TZ so CI can run the same suite from a handful of real
// offsets and catch any fixture that quietly assumed local time was UTC.
// Overwriting unconditionally would make that matrix a no-op.
if (!process.env.TZ) {
  process.env.TZ = "UTC";
}
