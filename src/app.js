const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const QRCode = require("qrcode");

const LoyaltyCard = require("./models/LoyaltyCard");
const accountNumber = require("./lib/accountNumber");
const { newToken, hashToken, newCode, safeEqual } = require("./lib/tokens");
const { PIZZAS_FOR_FREE, summarize } = require("./lib/countdown");
const emails = require("./lib/emails");

const { MAX_EVENTS } = LoyaltyCard;
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

function createApp({ config, mailer, now = () => new Date() }) {
  const app = express();

  if (config.trustProxy) {
    app.set("trust proxy", /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  }
  app.disable("x-powered-by");

  // Secrets travel in URLs and QR codes, so never leak them via Referer, and
  // only load our own scripts.
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(self)",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'",
    });
    next();
  });

  app.use(express.json({ limit: "10kb" }));

  // ---------- helpers ----------

  const origin = (req) => config.baseUrl || `${req.protocol}://${req.get("host")}`;

  function maskEmail(email) {
    if (!email) return null;
    const [user, domain] = email.split("@");
    return `${user[0]}***@${domain}`;
  }

  function lastUndoable(card) {
    const undone = new Set();
    for (let i = card.events.length - 1; i >= 0; i--) {
      const event = card.events[i];
      if (event.type === "undo") undone.add(event.undid);
      else if ((event.type === "punch" || event.type === "free") && !undone.has(event.seq)) return event;
    }
    return null;
  }

  function staffView(card) {
    const undoable = lastUndoable(card);
    const cooldownMs = config.punchCooldownSeconds * 1000;
    const sinceLastPunch = card.lastPunchAt ? now() - card.lastPunchAt : Infinity;

    return {
      accountNumber: card.accountNumber,
      accountNumberFormatted: accountNumber.format(card.accountNumber),
      customerName: card.customerName || null,
      email: maskEmail(card.email),
      emailStatus: card.emailStatus,
      countdown: summarize(card),
      lastPunchAt: card.lastPunchAt || null,
      recentPunchWarning: sinceLastPunch < cooldownMs ? Math.round(sinceLastPunch / 1000) : null,
      canUndo: Boolean(undoable),
      createdAt: card.createdAt,
      recentEvents: card.events.slice(-10).reverse().map((e) => ({
        type: e.type, qty: e.qty, at: e.at, by: e.by, note: e.note,
      })),
    };
  }

  function validEmail(raw) {
    const email = String(raw ?? "").trim().toLowerCase();
    return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
  }

  async function qrFor(req, card) {
    return QRCode.toDataURL(`${origin(req)}/c/${card.publicId}`, {
      errorCorrectionLevel: "M", margin: 2, width: 480,
    });
  }

  // Applies one change to a card safely even if two devices act at once:
  // read the card, decide what to change, and write only if nobody changed it
  // in between (eventSeq). Retries a few times, then asks the user to reload.
  async function applyChange(number, plan) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const card = await LoyaltyCard.findOne({ accountNumber: number });
      if (!card) return { status: 404, body: { message: "Card not found" } };

      const change = plan(card);
      if (change.error) return change.error;

      const seq = card.eventSeq + 1;
      const update = {
        $inc: { eventSeq: 1, ...(change.inc || {}) },
        $push: { events: { $each: [{ seq, at: now(), ...change.event }], $slice: -MAX_EVENTS } },
      };
      if (change.set && Object.keys(change.set).length) update.$set = change.set;
      if (change.unset) update.$unset = change.unset;

      const updated = await LoyaltyCard.findOneAndUpdate(
        { _id: card._id, eventSeq: card.eventSeq, ...(change.filter || {}) },
        update,
        { new: true }
      );
      if (updated) return { before: card, card: updated, seq };
    }
    return { status: 409, body: { message: "This card was just changed on another device. Look it up again." } };
  }

  function sendResult(res, result, extra = () => ({}), okStatus = 200) {
    if (result.status) return res.status(result.status).json(result.body);
    return res.status(okStatus).json({ card: staffView(result.card), ...extra(result) });
  }

  async function sendVerificationEmail(req, card, verifyToken) {
    const base = origin(req);
    const message = emails.verification({
      shopName: config.shopName,
      verifyUrl: `${base}/verify#${verifyToken}`,
      removeUrl: `${base}/remove-email#${card.publicId}`,
      cardUrl: `${base}/c/${card.publicId}`,
      accountNumber: accountNumber.format(card.accountNumber),
    });
    await mailer.send({ to: card.email, ...message });
  }

  // Returns the fields that put a card into "pending" with a fresh link.
  function pendingEmailFields(email, consent) {
    const verifyToken = newToken();
    return {
      verifyToken,
      fields: {
        email,
        emailStatus: "pending",
        consent: { version: config.consentVersion, at: now() },
        verifyTokenHash: hashToken(verifyToken),
        verifyExpiresAt: new Date(now().getTime() + config.verifyHours * 3600 * 1000),
      },
    };
  }

  // ---------- rate limits and staff auth ----------

  const apiLimiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false });
  // Only wrong keys (401s) count, so a busy counter is never locked out but
  // guessing the staff key is throttled hard.
  const authLimiter = rateLimit({
    windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => res.statusCode !== 401,
    message: { message: "Too many wrong attempts. Wait a minute and try again." },
  });
  const publicLimiter = rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: true, legacyHeaders: false });

  function requireStaff(req, res, next) {
    const key = req.header("x-staff-key");
    if (key && config.adminKey && safeEqual(key, config.adminKey)) req.staffRole = "admin";
    else if (key && config.staffKey && safeEqual(key, config.staffKey)) req.staffRole = "staff";
    else return res.status(401).json({ message: "Wrong staff key" });
    next();
  }

  const staff = [authLimiter, requireStaff];

  function parseNumber(req, res, next) {
    const digits = accountNumber.normalize(req.params.number);
    if (!digits || !accountNumber.isValid(digits)) {
      return res.status(400).json({ message: "That card number doesn't look right. Check the digits." });
    }
    req.number = digits;
    next();
  }

  app.use("/api/", apiLimiter);

  // ---------- staff API ----------

  app.get("/api/config", ...staff, (req, res) => {
    res.json({
      shopName: config.shopName,
      consentText: config.consentText,
      consentVersion: config.consentVersion,
      pizzasForFree: PIZZAS_FOR_FREE,
      maxPunchQty: config.maxPunchQty,
      allowFreeOverride: config.allowFreeOverride,
      role: req.staffRole,
    });
  });

  // Create a card at the register: QR + 7-digit number, optionally with email.
  app.post("/api/cards", ...staff, async (req, res) => {
    const customerName = String(req.body.customerName ?? "").trim().slice(0, 100) || undefined;

    let email = null;
    if (req.body.email) {
      email = validEmail(req.body.email);
      if (!email) return res.status(400).json({ message: "That email address doesn't look right." });
      if (req.body.consent !== true) {
        return res.status(400).json({ message: "The customer must agree to the email notice before we save their email." });
      }
    }

    let card;
    let verifyToken;
    for (let attempt = 0; attempt < 10 && !card; attempt++) {
      const doc = new LoyaltyCard({
        publicId: newToken(18),
        accountNumber: accountNumber.generate(),
        customerName,
        createdBy: req.staffRole,
        createdAt: now(),
      });
      if (email) {
        const pending = pendingEmailFields(email);
        verifyToken = pending.verifyToken;
        doc.set(pending.fields);
      }
      try {
        card = await doc.save();
      } catch (error) {
        if (error.code !== 11000) throw error; // duplicate number/ID: try again
      }
    }
    if (!card) return res.status(500).json({ message: "Could not create a card. Try again." });

    let emailSent = null;
    if (email) {
      try {
        await sendVerificationEmail(req, card, verifyToken);
        emailSent = true;
      } catch (error) {
        console.error("Verification email failed:", error.message);
        emailSent = false;
      }
    }

    res.status(201).json({ card: staffView(card), qr: await qrFor(req, card), emailSent });
  });

  // Find by QR contents (URL or ID), 7-digit number, or email.
  app.get("/api/cards/lookup", ...staff, async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ message: "Enter a card number or email." });

    let cards = [];
    if (q.includes("@") && !q.includes("/")) {
      const email = validEmail(q);
      if (!email) return res.status(400).json({ message: "That email address doesn't look right." });
      cards = await LoyaltyCard.find({ email }).sort({ createdAt: -1 }).limit(5);
    } else {
      const fromQr = q.match(/\/c\/([A-Za-z0-9_-]{20,64})/)?.[1] || (PUBLIC_ID_PATTERN.test(q) ? q : null);
      if (fromQr) {
        const card = await LoyaltyCard.findOne({ publicId: fromQr });
        if (card) cards = [card];
      } else {
        const digits = accountNumber.normalize(q);
        if (!digits) return res.status(400).json({ message: "Enter the 7-digit card number, or an email." });
        if (!accountNumber.isValid(digits)) {
          return res.status(400).json({ message: "That card number doesn't look right. Check the digits." });
        }
        const card = await LoyaltyCard.findOne({ accountNumber: digits });
        if (card) cards = [card];
      }
    }

    if (!cards.length) return res.status(404).json({ message: "No card found." });
    res.json({ cards: cards.map(staffView) });
  });

  // The QR image for an existing card (lost card, reprint).
  app.get("/api/cards/:number/qr", ...staff, parseNumber, async (req, res) => {
    const card = await LoyaltyCard.findOne({ accountNumber: req.number });
    if (!card) return res.status(404).json({ message: "Card not found" });
    res.json({ qr: await qrFor(req, card), cardUrl: `${origin(req)}/c/${card.publicId}` });
  });

  // Add paid pizzas. Every 9th earns a free one.
  app.post("/api/cards/:number/punch", ...staff, parseNumber, async (req, res) => {
    const qty = Number(req.body.qty ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > config.maxPunchQty) {
      return res.status(400).json({ message: `Enter 1 to ${config.maxPunchQty} pizzas.` });
    }
    const force = req.body.force === true;

    const result = await applyChange(req.number, (card) => {
      const sinceLast = card.lastPunchAt ? now() - card.lastPunchAt : Infinity;
      if (!force && sinceLast < config.punchCooldownSeconds * 1000) {
        return {
          error: {
            status: 409,
            body: {
              code: "RECENT_PUNCH",
              secondsAgo: Math.round(sinceLast / 1000),
              message: "This card was just punched. Is this a second order?",
            },
          },
        };
      }
      return {
        inc: { paidPizzas: qty },
        set: { lastPunchAt: now() },
        event: { type: "punch", qty, by: req.staffRole, note: force ? "second order confirmed" : undefined },
      };
    });

    sendResult(res, result, (r) => ({
      freeJustEarned: summarize(r.card).freeEarned > summarize(r.before).freeEarned,
    }));
  });

  // Reverse the most recent punch or free pizza (within the undo window).
  app.post("/api/cards/:number/undo", ...staff, parseNumber, async (req, res) => {
    const result = await applyChange(req.number, (card) => {
      const target = lastUndoable(card);
      if (!target) return { error: { status: 400, body: { message: "Nothing to undo." } } };

      const ageMs = now() - target.at;
      if (req.staffRole !== "admin" && ageMs > config.undoWindowMinutes * 60_000) {
        return { error: { status: 403, body: { message: `Too long ago to undo (over ${config.undoWindowMinutes} minutes). Ask the owner.` } } };
      }

      const event = { type: "undo", undid: target.seq, qty: target.qty, by: req.staffRole };
      if (target.type === "punch") {
        if (card.paidPizzas < target.qty) return { error: { status: 400, body: { message: "Can't undo: the count would go below zero." } } };
        return { inc: { paidPizzas: -target.qty }, event };
      }
      return { inc: { freeRedeemed: -1 }, event };
    });

    sendResult(res, result);
  });

  // Add or replace the email on an existing card, or re-send the link.
  app.post("/api/cards/:number/email", ...staff, parseNumber, async (req, res) => {
    const email = validEmail(req.body.email);
    if (!email) return res.status(400).json({ message: "That email address doesn't look right." });
    if (req.body.consent !== true) {
      return res.status(400).json({ message: "The customer must agree to the email notice before we save their email." });
    }

    const pending = pendingEmailFields(email);
    const result = await applyChange(req.number, () => ({
      set: pending.fields,
      unset: { emailVerifiedAt: 1, freeCode: 1 },
      event: { type: "email", by: req.staffRole, note: "email added" },
    }));
    if (result.status) return res.status(result.status).json(result.body);

    let emailSent = true;
    try {
      await sendVerificationEmail(req, result.card, pending.verifyToken);
    } catch (error) {
      console.error("Verification email failed:", error.message);
      emailSent = false;
    }
    res.json({ card: staffView(result.card), emailSent });
  });

  app.post("/api/cards/:number/email/remove", ...staff, parseNumber, async (req, res) => {
    const result = await applyChange(req.number, () => ({
      set: { emailStatus: "none" },
      unset: { email: 1, emailVerifiedAt: 1, consent: 1, verifyTokenHash: 1, verifyExpiresAt: 1, freeCode: 1 },
      event: { type: "email", by: req.staffRole, note: "email removed" },
    }));
    sendResult(res, result);
  });

  // Free pizza, step 1 (cards with a verified email): email a one-time code.
  app.post("/api/cards/:number/free/request-code", ...staff, parseNumber, async (req, res) => {
    const card = await LoyaltyCard.findOne({ accountNumber: req.number });
    if (!card) return res.status(404).json({ message: "Card not found" });
    if (card.emailStatus !== "verified") {
      return res.status(400).json({ message: "This card has no verified email. Use staff approval instead." });
    }
    if (summarize(card).freeAvailable < 1) {
      return res.status(400).json({ message: `No free pizza yet: ${summarize(card).pizzasUntilFree} more to go.` });
    }

    const code = newCode();
    const sentAt = now();
    const claimed = await LoyaltyCard.findOneAndUpdate(
      {
        _id: card._id,
        $or: [{ "freeCode.sentAt": { $exists: false } }, { "freeCode.sentAt": { $lt: new Date(sentAt.getTime() - 60_000) } }],
      },
      {
        $set: {
          freeCode: {
            hash: hashToken(code),
            sentAt,
            expiresAt: new Date(sentAt.getTime() + config.freeCodeMinutes * 60_000),
            attempts: 0,
          },
        },
      },
      { new: true }
    );
    if (!claimed) return res.status(429).json({ message: "A code was just sent. Wait a minute before sending another." });

    try {
      const message = emails.freeCode({
        shopName: config.shopName,
        code,
        minutes: config.freeCodeMinutes,
        removeUrl: `${origin(req)}/remove-email#${card.publicId}`,
      });
      await mailer.send({ to: card.email, ...message });
    } catch (error) {
      console.error("Free-pizza code email failed:", error.message);
      await LoyaltyCard.updateOne({ _id: card._id }, { $unset: { freeCode: 1 } });
      return res.status(502).json({ message: "Couldn't send the email. Try again, or use staff approval." });
    }
    res.json({ sent: true, to: maskEmail(card.email), expiresInMinutes: config.freeCodeMinutes });
  });

  // Free pizza, step 2: redeem with the emailed code, or with staff approval.
  app.post("/api/cards/:number/free", ...staff, parseNumber, async (req, res) => {
    const card = await LoyaltyCard.findOne({ accountNumber: req.number });
    if (!card) return res.status(404).json({ message: "Card not found" });

    const summary = summarize(card);
    if (summary.freeAvailable < 1) {
      return res.status(400).json({ message: `No free pizza yet: ${summary.pizzasUntilFree} more to go.` });
    }

    const verified = card.emailStatus === "verified";
    const code = String(req.body.code ?? "").trim();
    const reason = String(req.body.reason ?? "").trim().slice(0, 150);
    let note;

    if (code) {
      if (!verified) return res.status(400).json({ message: "This card has no verified email." });
      const consumed = await LoyaltyCard.findOneAndUpdate(
        {
          _id: card._id,
          "freeCode.hash": hashToken(code),
          "freeCode.expiresAt": { $gt: now() },
          "freeCode.attempts": { $lt: 5 },
        },
        { $unset: { freeCode: 1 } }
      );
      if (!consumed) {
        await LoyaltyCard.updateOne({ _id: card._id, "freeCode.hash": { $exists: true } }, { $inc: { "freeCode.attempts": 1 } });
        return res.status(400).json({ message: "That code is wrong or has expired." });
      }
      note = "confirmed with emailed code";
    } else if (req.body.approved === true) {
      if (verified) {
        if (!config.allowFreeOverride) {
          return res.status(403).json({ message: "This card has a verified email. Ask the customer for the code we emailed them." });
        }
        if (reason.length < 3) return res.status(400).json({ message: "Add a short reason for approving without the code." });
        note = `staff-approved without code: ${reason}`;
      } else {
        note = reason ? `staff-approved: ${reason}` : "staff-approved (no email on card)";
      }
    } else {
      return res.status(400).json({
        code: verified ? "CODE_REQUIRED" : "APPROVAL_REQUIRED",
        message: verified
          ? "Send the customer a code, or approve without one."
          : "No email on this card. Staff must approve this free pizza.",
      });
    }

    const result = await applyChange(req.number, (current) => {
      if (summarize(current).freeAvailable < 1) {
        return { error: { status: 400, body: { message: "No free pizza available." } } };
      }
      return {
        // Belt and braces: the write itself only matches if a free pizza is earned.
        filter: {
          $expr: { $gte: ["$paidPizzas", { $multiply: [{ $add: ["$freeRedeemed", 1] }, PIZZAS_FOR_FREE] }] },
        },
        inc: { freeRedeemed: 1 },
        event: { type: "free", qty: 1, by: req.staffRole, note },
      };
    });

    sendResult(res, result);
  });

  // ---------- customer-facing API (no staff key) ----------

  app.get("/api/public/cards/:publicId", publicLimiter, async (req, res) => {
    if (!PUBLIC_ID_PATTERN.test(req.params.publicId)) return res.status(404).json({ message: "Card not found" });
    const card = await LoyaltyCard.findOne({ publicId: req.params.publicId });
    if (!card) return res.status(404).json({ message: "Card not found" });

    res.json({
      shopName: config.shopName,
      customerName: card.customerName || null,
      accountNumberFormatted: accountNumber.format(card.accountNumber),
      emailStatus: card.emailStatus,
      // The countdown is a perk of registering and verifying an email.
      countdown: card.emailStatus === "verified" ? summarize(card) : null,
    });
  });

  app.get("/api/public/cards/:publicId/qr.png", publicLimiter, async (req, res) => {
    if (!PUBLIC_ID_PATTERN.test(req.params.publicId)) return res.status(404).end();
    const card = await LoyaltyCard.findOne({ publicId: req.params.publicId }).select("publicId");
    if (!card) return res.status(404).end();
    const png = await QRCode.toBuffer(`${origin(req)}/c/${card.publicId}`, {
      errorCorrectionLevel: "M", margin: 2, width: 480,
    });
    res.set("Cache-Control", "private, max-age=3600").type("png").send(png);
  });

  app.post("/api/public/verify", publicLimiter, async (req, res) => {
    const token = String(req.body.token ?? "");
    if (token.length < 20 || token.length > 100) return res.status(400).json({ message: "This link isn't valid." });

    const hash = hashToken(token);
    const verified = await LoyaltyCard.findOneAndUpdate(
      { verifyTokenHash: hash, emailStatus: "pending", verifyExpiresAt: { $gt: now() } },
      { $set: { emailStatus: "verified", emailVerifiedAt: now() }, $unset: { verifyExpiresAt: 1 } },
      { new: true }
    );
    if (verified) return res.json({ ok: true, publicId: verified.publicId });

    // Clicked a second time? Still fine.
    const already = await LoyaltyCard.findOne({ verifyTokenHash: hash, emailStatus: "verified" });
    if (already) return res.json({ ok: true, publicId: already.publicId });

    res.status(400).json({ message: "This link has expired or was replaced. Ask staff to send a new one." });
  });

  app.post("/api/public/remove-email", publicLimiter, async (req, res) => {
    const publicId = String(req.body.publicId ?? "");
    if (!PUBLIC_ID_PATTERN.test(publicId)) return res.status(400).json({ message: "This link isn't valid." });

    const card = await LoyaltyCard.findOne({ publicId });
    if (!card) return res.status(404).json({ message: "Card not found" });
    if (card.emailStatus === "none") return res.json({ ok: true });

    const seq = card.eventSeq + 1;
    await LoyaltyCard.updateOne(
      { _id: card._id },
      {
        $set: { emailStatus: "none" },
        $unset: { email: 1, emailVerifiedAt: 1, consent: 1, verifyTokenHash: 1, verifyExpiresAt: 1, freeCode: 1 },
        $inc: { eventSeq: 1 },
        $push: { events: { $each: [{ seq, type: "email", at: now(), by: "staff", note: "removed by customer" }], $slice: -MAX_EVENTS } },
      }
    );
    res.json({ ok: true });
  });

  // ---------- pages ----------

  const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
  app.get("/", (req, res) => res.redirect("/register"));
  app.get("/register", page("register.html"));
  app.get("/c/:publicId", page("card.html"));
  app.get("/verify", page("verify.html"));
  app.get("/remove-email", page("remove.html"));
  app.get("/vendor/html5-qrcode.min.js", (req, res) =>
    res.sendFile(path.join(__dirname, "..", "node_modules", "html5-qrcode", "html5-qrcode.min.js"))
  );
  app.use(express.static(PUBLIC_DIR, { index: false }));

  app.use("/api/", (req, res) => res.status(404).json({ message: "Not found" }));

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error.type === "entity.parse.failed" || error.type === "entity.too.large") {
      return res.status(400).json({ message: "Bad request." });
    }
    console.error(error);
    res.status(500).json({ message: "Something went wrong. Try again." });
  });

  return app;
}

module.exports = { createApp };
