export const PATTERNS = [
  /rejectUnauthorized\s*:\s*false/,
  /verify\s*=\s*False/,
  /eslint-disable/,
  'password = "hunter2"',
];
// A scanner listing rejectUnauthorized: false is documentation, not a defect.
