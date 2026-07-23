import assert from "node:assert/strict";
import test from "node:test";
import { NonRetryableError } from "../src/errors.js";
import { canonicalTableColumnEntries } from "../src/writers/table-columns.js";

test("iterates canonical table columns as name and descriptor entries", () => {
  assert.deepEqual(
    canonicalTableColumnEntries(
      {
        state: { type: "symbol", value: "RUNNING" },
        power: { type: "double", value: 42.1, uom: "kW" },
      },
      "measurements_table",
    ),
    [
      ["state", { type: "symbol", value: "RUNNING" }],
      ["power", { type: "double", value: 42.1, uom: "kW" }],
    ],
  );
});

test("rejects an unnormalized legacy array at the writer boundary", () => {
  assert.throws(
    () =>
      canonicalTableColumnEntries(
        [{ name: "power", type: "double", value: 42.1 }],
        "measurements_table",
      ),
    (error: unknown) =>
      error instanceof NonRetryableError &&
      error.message.includes("must be a canonical object"),
  );
});

test("rejects empty or malformed canonical columns", () => {
  assert.throws(
    () => canonicalTableColumnEntries({}, "measurements_table"),
    /missing or empty/,
  );
  assert.throws(
    () =>
      canonicalTableColumnEntries(
        { power: { value: 42.1 } },
        "measurements_table",
      ),
    /Invalid column definition 'power'/,
  );
});
