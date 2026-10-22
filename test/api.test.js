const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { createApp } = require("../src/app");
const { fromEnv } = require("../src/config");
const LoyaltyCard = require("../src/models/LoyaltyCard");

const STAFF = "staff-key-123456";
const ADMIN = "admin-key-654321";

let mongod;
let server;
let base;
let mailbox;
let clock;

function makeConfig(overrides = {}) {
  return {
    ...fromEnv({ SHOP_NAME: "Testville Pizza", STAFF_KEY: STAFF, ADMIN_KEY: ADMIN, BASE_URL: "https://pizza.test" }),
    ...overrides,
  };
}

async function start(overrides) {
  mailbox = [];
  clock = { t: Date.parse("2026-10-21T18:00:00Z") };
  const mailer = {
    async send(message) {
      if (mailer.fail) throw new Error("provider down");
      mailbox.push(message);
      return { delivered: true };
    },
  };
  const app = createApp({ config: makeConfig(overrides), mailer, now: () => new Date(clock.t) });
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  return mailer;
}

async function call(method, path, { key = STAFF, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(key ? { "x-staff-key": key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, json, text };
}

const post = (path, body, opts) => call("POST", path, { body: body ?? {}, ...opts });

async function newCard(body = {}) {
  const r = await post("/api/cards", body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
}

const advance = (seconds) => { clock.t += seconds * 1000; };
const tokenFromMail = (message) => message.text.match(/\/verify#(\S+)/)[1];
const codeFromMail = (message) => message.text.match(/code is (\d{6})/)[1];

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: "test" });
  await LoyaltyCard.init();
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test.beforeEach(async () => {
  await LoyaltyCard.deleteMany({});
  await start();
});

test.afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// ---------------------------------------------------------------- creating

test("staff can create a card with a QR and a valid 7-digit number, no email", async () => {
  const { card, qr, emailSent } = await newCard({ customerName: "Maria" });
  assert.match(card.accountNumber, /^\d{7}$/);
  assert.match(card.accountNumberFormatted, /^\d{3}-\d{4}$/);
  assert.match(qr, /^data:image\/png;base64,/);
  assert.equal(emailSent, null);
  assert.equal(card.emailStatus, "none");
  assert.equal(card.countdown.pizzasUntilFree, 9);
  assert.equal(mailbox.length, 0);
});

test("creating a card needs a staff key", async () => {
  assert.equal((await post("/api/cards", {}, { key: null })).status, 401);
  assert.equal((await post("/api/cards", {}, { key: "nope" })).status, 401);
  assert.equal((await post("/api/cards", {}, { key: ADMIN })).status, 201);
});

test("an email needs the customer's agreement, and must look like an email", async () => {
  const noConsent = await post("/api/cards", { email: "a@b.com" });
  assert.equal(noConsent.status, 400);
  assert.match(noConsent.json.message, /agree/);

  const badEmail = await post("/api/cards", { email: "not-an-email", consent: true });
  assert.equal(badEmail.status, 400);
  assert.equal(await LoyaltyCard.countDocuments(), 0);
});

test("email flow: pending until the link is opened, countdown only after", async () => {
  const { card, emailSent } = await newCard({ email: "Pat@Example.com", consent: true });
  assert.equal(emailSent, true);
  assert.equal(card.emailStatus, "pending");
  assert.equal(card.email, "p***@example.com");
  assert.equal(mailbox.length, 1);
  assert.equal(mailbox[0].to, "pat@example.com");
  assert.match(mailbox[0].text, /https:\/\/pizza\.test\/verify#/);
  assert.match(mailbox[0].text, /remove-email#/);

  const stored = await LoyaltyCard.findOne({ accountNumber: card.accountNumber });
  assert.equal(stored.consent.version, "2026-10-v1");
  assert.ok(stored.consent.at);
  assert.notEqual(stored.verifyTokenHash, tokenFromMail(mailbox[0]), "only a hash is stored");

  const before = await call("GET", `/api/public/cards/${stored.publicId}`, { key: null });
  assert.equal(before.json.emailStatus, "pending");
  assert.equal(before.json.countdown, null);

  const verify = await post("/api/public/verify", { token: tokenFromMail(mailbox[0]) }, { key: null });
  assert.equal(verify.status, 200);
  assert.equal(verify.json.publicId, stored.publicId);

  const after = await call("GET", `/api/public/cards/${stored.publicId}`, { key: null });
  assert.equal(after.json.emailStatus, "verified");
  assert.equal(after.json.countdown.pizzasUntilFree, 9);
  assert.equal(JSON.stringify(after.json).includes("example.com"), false, "customer page never shows the email");

  // opening the link twice is harmless
  assert.equal((await post("/api/public/verify", { token: tokenFromMail(mailbox[0]) }, { key: null })).status, 200);
});

test("a wrong or expired verification link is rejected", async () => {
  const { card } = await newCard({ email: "pat@example.com", consent: true });
  const token = tokenFromMail(mailbox[0]);

  assert.equal((await post("/api/public/verify", { token: "x".repeat(30) }, { key: null })).status, 400);

  advance(73 * 3600);
  assert.equal((await post("/api/public/verify", { token }, { key: null })).status, 400);

  // staff re-send gives a fresh working link and kills the old one
  const resend = await post(`/api/cards/${card.accountNumber}/email`, { email: "pat@example.com", consent: true });
  assert.equal(resend.status, 200);
  assert.equal((await post("/api/public/verify", { token }, { key: null })).status, 400);
  assert.equal((await post("/api/public/verify", { token: tokenFromMail(mailbox[1]) }, { key: null })).status, 200);
});

test("card is still created if the email provider is down, and staff are told", async () => {
  await new Promise((r) => server.close(r));
  const mailer = await start();
  mailer.fail = true;
  const r = await post("/api/cards", { email: "pat@example.com", consent: true });
  assert.equal(r.status, 201);
  assert.equal(r.json.emailSent, false);
  assert.equal(await LoyaltyCard.countDocuments(), 1);
});

test("customer can remove their email from the link", async () => {
  const { card } = await newCard({ email: "pat@example.com", consent: true });
  const stored = await LoyaltyCard.findOne({ accountNumber: card.accountNumber });
  const r = await post("/api/public/remove-email", { publicId: stored.publicId }, { key: null });
  assert.equal(r.status, 200);
  const after = await LoyaltyCard.findOne({ accountNumber: card.accountNumber });
  assert.equal(after.email, undefined);
  assert.equal(after.emailStatus, "none");
  assert.equal(after.verifyTokenHash, undefined);
  assert.equal(after.consent.at, undefined);
});

// ----------------------------------------------------------------- lookup

test("lookup by number, formatted number, QR link, public id and email", async () => {
  const { card } = await newCard({ email: "pat@example.com", consent: true });
  const stored = await LoyaltyCard.findOne({ accountNumber: card.accountNumber });
  const find = (q) => call("GET", `/api/cards/lookup?q=${encodeURIComponent(q)}`);

  for (const q of [
    card.accountNumber,
    card.accountNumberFormatted,
    `https://pizza.test/c/${stored.publicId}`,
    stored.publicId,
    "PAT@example.com",
  ]) {
    const r = await find(q);
    assert.equal(r.status, 200, q);
    assert.equal(r.json.cards[0].accountNumber, card.accountNumber);
  }
  const badDigit = card.accountNumber.slice(0, 6) + ((Number(card.accountNumber[6]) + 1) % 10);
  assert.equal((await find(badDigit)).status, 400, "bad check digit is called out");
  assert.equal((await find("12")).status, 400);
  assert.equal((await find("nobody@example.com")).status, 404);
});

// --------------------------------------------------------------- punching

test("punching adds pizzas; the 9th earns a free one", async () => {
  const { card } = await newCard();
  const n = card.accountNumber;

  const first = await post(`/api/cards/${n}/punch`, { qty: 2 });
  assert.equal(first.json.card.countdown.pizzasUntilFree, 7);
  assert.equal(first.json.freeJustEarned, false);

  advance(600);
  const rest = await post(`/api/cards/${n}/punch`, { qty: 7 });
  assert.equal(rest.json.freeJustEarned, true);
  assert.equal(rest.json.card.countdown.freeAvailable, 1);
  assert.equal(rest.json.card.countdown.pizzasUntilFree, 0);
});

test("buying several pizzas at once carries extras toward the next free one", async () => {
  const { card } = await newCard();
  const n = card.accountNumber;
  await post(`/api/cards/${n}/punch`, { qty: 8 });
  advance(600);
  const r = await post(`/api/cards/${n}/punch`, { qty: 3 });
  assert.equal(r.json.card.countdown.freeAvailable, 1);
  assert.equal(r.json.card.countdown.towardNext, 2);
});

test("quantity must be a sensible whole number", async () => {
  const { card } = await newCard();
  for (const qty of [0, -1, 1.5, 11, "x"]) {
    const r = await post(`/api/cards/${card.accountNumber}/punch`, { qty });
    assert.equal(r.status, 400, String(qty));
  }
  assert.equal((await LoyaltyCard.findOne({})).paidPizzas, 0);
});

test("a second scan right away asks staff to confirm; confirming punches", async () => {
  const { card } = await newCard();
  const n = card.accountNumber;
  assert.equal((await post(`/api/cards/${n}/punch`, { qty: 1 })).status, 200);

  advance(30);
  const dup = await post(`/api/cards/${n}/punch`, { qty: 1 });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.code, "RECENT_PUNCH");
  assert.equal((await LoyaltyCard.findOne({})).paidPizzas, 1, "nothing was added");

  assert.equal((await post(`/api/cards/${n}/punch`, { qty: 1, force: true })).status, 200);
  assert.equal((await LoyaltyCard.findOne({})).paidPizzas, 2);

  advance(10 * 60);
  assert.equal((await post(`/api/cards/${n}/punch`, { qty: 1 })).status, 200, "no prompt after the cooldown");
});

test("a mistyped number never punches anything", async () => {
  const { card } = await newCard();
  const typo = card.accountNumber.slice(0, 6) + ((Number(card.accountNumber[6]) + 1) % 10);
  const r = await post(`/api/cards/${typo}/punch`, { qty: 1 });
  assert.equal(r.status, 400);
  assert.equal((await LoyaltyCard.findOne({})).paidPizzas, 0);
});

// ------------------------------------------------------------- free pizza

test("no free pizza until 9 are bought", async () => {
  const { card } = await newCard();
  await post(`/api/cards/${card.accountNumber}/punch`, { qty: 8 });
  const r = await post(`/api/cards/${card.accountNumber}/free`, { approved: true });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /1 more/);
  assert.equal((await LoyaltyCard.findOne({})).freeRedeemed, 0);
});

test("card without email: free pizza needs staff approval, then resets the countdown", async () => {
  const { card } = await newCard();
  const n = card.accountNumber;
  await post(`/api/cards/${n}/punch`, { qty: 9 });

  const asked = await post(`/api/cards/${n}/free`, {});
  assert.equal(asked.status, 400);
  assert.equal(asked.json.code, "APPROVAL_REQUIRED");

  const ok = await post(`/api/cards/${n}/free`, { approved: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.card.countdown.freeAvailable, 0);
  assert.equal(ok.json.card.countdown.pizzasUntilFree, 9);
  assert.equal(ok.json.card.recentEvents[0].type, "free");

  // can't take it twice
  assert.equal((await post(`/api/cards/${n}/free`, { approved: true })).status, 400);
});

async function verifiedCardWithFreePizza() {
  const { card } = await newCard({ email: "pat@example.com", consent: true });
  await post("/api/public/verify", { token: tokenFromMail(mailbox[0]) }, { key: null });
  await post(`/api/cards/${card.accountNumber}/punch`, { qty: 9 });
  mailbox.length = 0;
  return card.accountNumber;
}

test("verified email: free pizza needs the emailed code", async () => {
  const n = await verifiedCardWithFreePizza();

  const asked = await post(`/api/cards/${n}/free`, {});
  assert.equal(asked.json.code, "CODE_REQUIRED");

  const sent = await post(`/api/cards/${n}/free/request-code`);
  assert.equal(sent.status, 200);
  assert.equal(sent.json.to, "p***@example.com");
  const code = codeFromMail(mailbox[0]);

  const wrong = await post(`/api/cards/${n}/free`, { code: code === "000000" ? "111111" : "000000" });
  assert.equal(wrong.status, 400);
  assert.equal((await LoyaltyCard.findOne({})).freeRedeemed, 0);

  const ok = await post(`/api/cards/${n}/free`, { code });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.card.countdown.freeAvailable, 0);

  const stored = await LoyaltyCard.findOne({});
  assert.equal(stored.freeCode.hash, undefined, "code is single use");
  assert.match(stored.events.at(-1).note, /emailed code/);
});

test("emailed codes expire and lock out after 5 wrong guesses", async () => {
  const n = await verifiedCardWithFreePizza();

  await post(`/api/cards/${n}/free/request-code`);
  const code = codeFromMail(mailbox[0]);
  advance(11 * 60);
  assert.equal((await post(`/api/cards/${n}/free`, { code })).status, 400, "expired");

  advance(120);
  await post(`/api/cards/${n}/free/request-code`);
  const fresh = codeFromMail(mailbox[1]);
  const wrongGuess = fresh === "123456" ? "654321" : "123456";
  for (let i = 0; i < 5; i++) assert.equal((await post(`/api/cards/${n}/free`, { code: wrongGuess })).status, 400);
  assert.equal((await post(`/api/cards/${n}/free`, { code: fresh })).status, 400, "locked even with the right code");
  assert.equal((await LoyaltyCard.findOne({})).freeRedeemed, 0);
});

test("codes can't be spammed to the customer", async () => {
  const n = await verifiedCardWithFreePizza();
  assert.equal((await post(`/api/cards/${n}/free/request-code`)).status, 200);
  assert.equal((await post(`/api/cards/${n}/free/request-code`)).status, 429);
  assert.equal(mailbox.length, 1);
  advance(61);
  assert.equal((await post(`/api/cards/${n}/free/request-code`)).status, 200);
});

test("verified email: staff can approve without the code, with a reason, and it's logged", async () => {
  const n = await verifiedCardWithFreePizza();

  const noReason = await post(`/api/cards/${n}/free`, { approved: true });
  assert.equal(noReason.status, 400);

  const ok = await post(`/api/cards/${n}/free`, { approved: true, reason: "phone died" });
  assert.equal(ok.status, 200);
  assert.match((await LoyaltyCard.findOne({})).events.at(-1).note, /without code: phone died/);
});

test("the owner can switch staff approval off for verified cards", async () => {
  await new Promise((r) => server.close(r));
  await start({ allowFreeOverride: false });
  const n = await verifiedCardWithFreePizza();
  const r = await post(`/api/cards/${n}/free`, { approved: true, reason: "phone died" });
  assert.equal(r.status, 403);
  assert.equal((await LoyaltyCard.findOne({})).freeRedeemed, 0);
});

// -------------------------------------------------------------------- undo

test("undo reverses the last punch, then the free pizza, in order", async () => {
  const { card } = await newCard();
  const n = card.accountNumber;
  await post(`/api/cards/${n}/punch`, { qty: 9 });
  await post(`/api/cards/${n}/free`, { approved: true });

  const undoFree = await post(`/api/cards/${n}/undo`);
  assert.equal(undoFree.json.card.countdown.freeAvailable, 1);

  const undoPunch = await post(`/api/cards/${n}/undo`);
  assert.equal(undoPunch.json.card.countdown.paidPizzas, 0);

  const nothing = await post(`/api/cards/${n}/undo`);
  assert.equal(nothing.status, 400);
});

test("staff can only undo within the window; the owner always can", async () => {
  const { card } = await newCard();
  const n = card.accountNumber;
  await post(`/api/cards/${n}/punch`, { qty: 3 });
  advance(61 * 60);
  assert.equal((await post(`/api/cards/${n}/undo`)).status, 403);
  assert.equal((await post(`/api/cards/${n}/undo`, {}, { key: ADMIN })).status, 200);
});

// ------------------------------------------------------------- two devices

test("two devices redeeming the same free pizza at once: exactly one wins", async () => {
  const { card } = await newCard();
  const n = card.accountNumber;
  await post(`/api/cards/${n}/punch`, { qty: 9 });

  const results = await Promise.all(
    Array.from({ length: 6 }, () => post(`/api/cards/${n}/free`, { approved: true }))
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal((await LoyaltyCard.findOne({})).freeRedeemed, 1);
});

test("simultaneous punches never lose or double count", async () => {
  const { card } = await newCard();
  const n = card.accountNumber;
  const results = await Promise.all(
    Array.from({ length: 8 }, () => post(`/api/cards/${n}/punch`, { qty: 1, force: true }))
  );
  const ok = results.filter((r) => r.status === 200).length;
  const stored = await LoyaltyCard.findOne({});
  assert.equal(stored.paidPizzas, ok, "count equals the number of confirmed punches");
  assert.ok(ok >= 1);
  for (const r of results) assert.ok([200, 409].includes(r.status), `unexpected ${r.status}`);
});

// ---------------------------------------------------------------- security

test("customer endpoints reveal nothing about unknown cards", async () => {
  const missing = await call("GET", "/api/public/cards/" + "a".repeat(24), { key: null });
  assert.equal(missing.status, 404);
  assert.equal((await call("GET", "/api/public/cards/short", { key: null })).status, 404);
});

test("a card with no email shows the customer no countdown", async () => {
  const { card } = await newCard();
  const stored = await LoyaltyCard.findOne({ accountNumber: card.accountNumber });
  const r = await call("GET", `/api/public/cards/${stored.publicId}`, { key: null });
  assert.equal(r.json.countdown, null);
  assert.equal(r.json.emailStatus, "none");
});

test("staff API never leaks hashes, tokens or full emails", async () => {
  const { card } = await newCard({ email: "pat@example.com", consent: true });
  const r = await call("GET", `/api/cards/lookup?q=${card.accountNumber}`);
  const text = JSON.stringify(r.json);
  for (const secret of ["Hash", "publicId", "pat@example.com", "freeCode"]) {
    assert.equal(text.includes(secret), false, `leaked ${secret}`);
  }
});

test("guessing the staff key is throttled, but wrong-key counting ignores good requests", async () => {
  for (let i = 0; i < 12; i++) await post("/api/cards", {});            // 12 good requests: fine
  for (let i = 0; i < 10; i++) assert.equal((await post("/api/cards", {}, { key: "guess" + i })).status, 401);
  assert.equal((await post("/api/cards", {}, { key: "guess-last" })).status, 429);
});

test("pages and the vendored scanner are served; bad JSON is a 400", async () => {
  for (const path of ["/register", "/c/" + "a".repeat(24), "/verify", "/remove-email", "/vendor/html5-qrcode.min.js"]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  }
  const bad = await fetch(base + "/api/public/verify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{nope",
  });
  assert.equal(bad.status, 400);
});
