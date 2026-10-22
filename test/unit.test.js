const test = require("node:test");
const assert = require("node:assert/strict");

const accountNumber = require("../src/lib/accountNumber");
const { summarize } = require("../src/lib/countdown");
const { hashToken, safeEqual, newCode } = require("../src/lib/tokens");

test("generated account numbers are 7 digits and pass their own check", () => {
  for (let i = 0; i < 2000; i++) {
    const n = accountNumber.generate();
    assert.match(n, /^\d{7}$/);
    assert.equal(accountNumber.isValid(n), true);
  }
});

test("a mistyped digit is always caught (single-digit errors)", () => {
  const n = accountNumber.generate();
  for (let pos = 0; pos < 7; pos++) {
    for (let d = 0; d <= 9; d++) {
      if (String(d) === n[pos]) continue;
      const typo = n.slice(0, pos) + d + n.slice(pos + 1);
      assert.equal(accountNumber.isValid(typo), false, `${n} -> ${typo}`);
    }
  }
});

test("account numbers accept spaces and dashes, reject junk", () => {
  const n = accountNumber.generate();
  assert.equal(accountNumber.normalize(accountNumber.format(n)), n);
  assert.equal(accountNumber.normalize(` ${n.slice(0, 3)} ${n.slice(3)} `), n);
  assert.equal(accountNumber.normalize("12345"), null);
  assert.equal(accountNumber.normalize("abcdefg"), null);
  assert.equal(accountNumber.normalize(undefined), null);
});

test("countdown: buy 9, the 10th is free", () => {
  assert.deepEqual(
    [0, 1, 8].map((n) => summarize({ paidPizzas: n }).pizzasUntilFree),
    [9, 8, 1]
  );
  const nine = summarize({ paidPizzas: 9 });
  assert.equal(nine.freeAvailable, 1);
  assert.equal(nine.pizzasUntilFree, 0);

  const redeemed = summarize({ paidPizzas: 9, freeRedeemed: 1 });
  assert.equal(redeemed.freeAvailable, 0);
  assert.equal(redeemed.pizzasUntilFree, 9);
});

test("countdown: extra pizzas in one order carry over, nothing is lost", () => {
  const s = summarize({ paidPizzas: 11, freeRedeemed: 0 });
  assert.equal(s.freeAvailable, 1);
  assert.equal(s.towardNext, 2);

  const twoFree = summarize({ paidPizzas: 18 });
  assert.equal(twoFree.freeAvailable, 2);
});

test("tokens: hashing is stable, comparison is exact, codes are 6 digits", () => {
  assert.equal(hashToken("abc"), hashToken("abc"));
  assert.notEqual(hashToken("abc"), hashToken("abd"));
  assert.equal(safeEqual("key", "key"), true);
  assert.equal(safeEqual("key", "kex"), false);
  assert.equal(safeEqual("key", "keys"), false);
  assert.equal(safeEqual("key", undefined), false);
  assert.match(newCode(), /^\d{6}$/);
});
