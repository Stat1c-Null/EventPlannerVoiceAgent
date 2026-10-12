import { test } from "node:test";
import assert from "node:assert/strict";
import { mockConfirmation } from "../src/services/booking.ts";
import { sendShareLink, shareMessage, type SmsSender } from "../src/services/sms.ts";

test("mockConfirmation uses a kind-specific prefix and is always simulated", () => {
  assert.match(mockConfirmation("dinner").code, /^RSV-[A-Z2-9]{5}$/);
  assert.match(mockConfirmation("parking").code, /^PRK-[A-Z2-9]{5}$/);
  assert.match(mockConfirmation("gift").code, /^GFT-[A-Z2-9]{5}$/);
  assert.equal(mockConfirmation("venue").simulated, true);
});

test("mockConfirmation handles the extremes of the random source", () => {
  assert.match(mockConfirmation("food", () => 0).code, /^RSV-A{5}$/);
  assert.match(mockConfirmation("food", () => 0.9999999).code, /^RSV-9{5}$/);
});

test("shareMessage contains the ID, the link, and the simulated notice", () => {
  const message = shareMessage("BLUE-FALCON-42", "http://localhost:3000");
  assert.ok(message.includes("BLUE-FALCON-42"));
  assert.ok(message.includes("http://localhost:3000/e/BLUE-FALCON-42"));
  assert.ok(message.toLowerCase().includes("simulated"));
});

test("sendShareLink sends from the agent number to the caller", async () => {
  const sent: string[][] = [];
  const sender: SmsSender = { sendSms: async (from, to, message) => void sent.push([from, to, message]) };
  const ok = await sendShareLink({
    sender, from: "+12402514603", to: "+15551234567", eventId: "BLUE-FALCON-42", publicBaseUrl: "http://localhost:3000",
  });
  assert.equal(ok, true);
  assert.deepEqual(sent.map(([from, to]) => [from, to]), [["+12402514603", "+15551234567"]]);
});

test("sendShareLink returns false without a caller number and sends nothing", async () => {
  let calls = 0;
  const sender: SmsSender = { sendSms: async () => void calls++ };
  const ok = await sendShareLink({
    sender, from: "+12402514603", to: null, eventId: "X-Y-10", publicBaseUrl: "http://localhost:3000",
  });
  assert.equal(ok, false);
  assert.equal(calls, 0);
});

test("sendShareLink returns false and reports the error when sending fails", async () => {
  const errors: unknown[] = [];
  const sender: SmsSender = { sendSms: async () => { throw new Error("SMS not enabled"); } };
  const ok = await sendShareLink({
    sender, from: "+12402514603", to: "+15551234567", eventId: "X-Y-10",
    publicBaseUrl: "http://localhost:3000", onError: (e) => errors.push(e),
  });
  assert.equal(ok, false);
  assert.equal(errors.length, 1);
});
