import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUsd } from "../src/money.ts";

test("formatUsd formats plain numbers and numeric text as US dollars", () => {
  assert.equal(formatUsd(200), "$200");
  assert.equal(formatUsd("200"), "$200");
  assert.equal(formatUsd("$200"), "$200");
  assert.equal(formatUsd("about 2000 dollars"), "$2,000");
  assert.equal(formatUsd("1,500.50"), "$1,500.50");
});

test("formatUsd returns null when there is no amount to format", () => {
  assert.equal(formatUsd("two hundred"), null);
  assert.equal(formatUsd(""), null);
  assert.equal(formatUsd(null), null);
});
