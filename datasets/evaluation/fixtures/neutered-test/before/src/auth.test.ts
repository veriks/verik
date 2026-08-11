import { expect, it } from "vitest";
it("rejects non-admins", () => {
  expect(user.isAdmin).toBe(false);
});
