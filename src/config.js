const path = require("path");

// Load .env once (the real server). Tests pass their own config instead.
function loadEnv() {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
}

// Bump CONSENT_VERSION whenever the consent wording changes, so we can tell
// which wording each customer agreed to.
const CONSENT_VERSION = "2026-10-v1";

function consentText(shopName) {
  return (
    `${shopName} will use your email only to verify your card, show your pizza ` +
    `countdown, and send a confirmation code when you redeem a free pizza. ` +
    `We won't sell or share it and we won't send promotions. You can ask us to ` +
    `remove it at any time, or use the link in any email we send you.`
  );
}

function fromEnv(env = process.env) {
  return {
    baseUrl: (env.BASE_URL || "").replace(/\/+$/, ""),
    shopName: env.SHOP_NAME || "Saucies",
    adminKey: env.ADMIN_KEY || "",
    staffKey: env.STAFF_KEY || "",
    // Seconds during which a second punch on the same card needs staff to confirm
    // ("is this a second order?"). Guards against double scans.
    punchCooldownSeconds: Number(env.PUNCH_COOLDOWN_SECONDS ?? 300),
    // Max pizzas staff can add to a card in one go.
    maxPunchQty: Number(env.MAX_PUNCH_QTY ?? 10),
    // If true, staff can approve a free pizza without the emailed code
    // (always possible for cards with no verified email).
    allowFreeOverride: env.ALLOW_FREE_OVERRIDE !== "false",
    // Staff can undo their last punch/free-pizza within this many minutes
    // (admin has no limit).
    undoWindowMinutes: Number(env.UNDO_WINDOW_MINUTES ?? 60),
    verifyHours: Number(env.VERIFY_LINK_HOURS ?? 72),
    freeCodeMinutes: Number(env.FREE_CODE_MINUTES ?? 10),
    trustProxy: env.TRUST_PROXY || "",
    consentVersion: CONSENT_VERSION,
    consentText: consentText(env.SHOP_NAME || "Saucies"),
  };
}

module.exports = { loadEnv, fromEnv, CONSENT_VERSION };
