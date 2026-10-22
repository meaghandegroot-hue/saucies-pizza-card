const crypto = require("crypto");

// Random URL-safe secret (used in QR codes and emailed links).
function newToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

// Only the hash of a secret is stored for one-time tokens, so a database leak
// doesn't hand out working verification links.
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

// 6-digit one-time code, e.g. for confirming a free pizza.
function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

// Constant-time string comparison (staff keys).
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ""));
  const bufB = Buffer.from(String(b ?? ""));
  if (bufA.length !== bufB.length) {
    // Still burn comparable time, then fail.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { newToken, hashToken, newCode, safeEqual };
