// DORMANT: the original slice-card system, kept intact for reference.
// Run on its own with `npm run legacy` (port 3001 by default). It is not
// loaded by the main server.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const QRCode = require("qrcode");

const PizzaCard = require("./models/PizzaCard");
const ShopStats = require("./models/ShopStats");

const app = express();

// Fire-and-forget push notification to the owner's phone via ntfy.sh (free,
// no account needed — just a hard-to-guess topic name to subscribe to in the
// ntfy app). Never let a notification failure affect the actual API response.
async function sendOwnerAlert(message) {
  if (!process.env.NTFY_TOPIC) return;

  try {
    await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
      method: "POST",
      body: message,
    });
  } catch (error) {
    console.error("Failed to send owner alert:", error);
  }
}

// Odds are checked in order and the first hit wins; anything left over
// (the common case) means no reward. Tune freely — these are shop decisions,
// not engineering ones.
const REWARD_TABLE = [
  { label: "Full free reload", chance: 0.02 },
  { label: "Free drink", chance: 0.05 },
  { label: "Free topping", chance: 0.10 },
];

function rollReward() {
  const roll = Math.random();
  let cumulative = 0;

  for (const reward of REWARD_TABLE) {
    cumulative += reward.chance;
    if (roll < cumulative) return reward.label;
  }

  return null;
}

async function countRedemptionsSince(since) {
  const [result] = await PizzaCard.aggregate([
    { $unwind: "$redemptions" },
    { $match: { "redemptions.at": { $gte: since } } },
    { $count: "count" },
  ]);

  return result?.count || 0;
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.BASE_URL || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

app.get("/", (req, res) => {
  res.send("Pizza Card Server Running");
});

function handleError(res, error, fallbackMessage = "Something went wrong") {
  if (error.name === "CastError") {
    return res.status(400).json({ message: "Invalid card ID" });
  }

  if (error.name === "ValidationError") {
    return res.status(400).json({ message: error.message });
  }

  console.error(error);
  return res.status(500).json({ message: fallbackMessage });
}

// Generous limit on all API routes to blunt scraping/enumeration.
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", readLimiter);

// Tight limit on the two key-guarded routes so a 6-digit key can't be brute-forced.
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts — please wait a moment and try again." },
});

function requireAdmin(req, res, next) {
  const key = req.header("x-staff-key");

  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  next();
}

function requireStaff(req, res, next) {
  const key = req.header("x-staff-key");

  if (key && (key === process.env.ADMIN_KEY || key === process.env.STAFF_KEY)) {
    req.staffRole = key === process.env.ADMIN_KEY ? "admin" : "staff";
    return next();
  }

  return res.status(401).json({ message: "Unauthorized" });
}

app.post("/api/cards", authLimiter, requireAdmin, async (req, res) => {
  try {
    const bonus = req.body.bonus ? 1 : 0;

    let referrer = null;
    if (req.body.referredBy && mongoose.Types.ObjectId.isValid(req.body.referredBy)) {
      referrer = await PizzaCard.findById(req.body.referredBy);
    }
    const referralApplied = Boolean(referrer);
    const totalSlices = 10 + bonus + (referralApplied ? 1 : 0);

    const newCard = new PizzaCard({
      customerName: req.body.customerName,
      totalSlices,
      slicesRemaining: totalSlices,
      groupName: req.body.groupName || undefined,
      referredBy: referralApplied ? referrer._id : undefined,
      birthday: req.body.birthday || undefined,
    });

    await newCard.save();

    if (referralApplied) {
      await PizzaCard.updateOne(
        { _id: referrer._id },
        { $inc: { slicesRemaining: 1, totalSlices: 1 } }
      );
    }

    res.status(201).json({
      ...newCard.toObject(),
      referralApplied,
      referralNotFound: Boolean(req.body.referredBy) && !referralApplied,
    });

  } catch (error) {
    handleError(res, error);
  }
});

// Grants a once-a-year birthday slice the first time a card is viewed on the
// customer's birthday. Checked lazily on read (rather than a scheduled cron)
// so it still fires correctly even on hosts that spin down when idle.
async function applyBirthdayBonusIfDue(card) {
  if (!card.birthday) return { card, birthdayBonusGranted: false };

  const now = new Date();
  const birthday = new Date(card.birthday);
  const isBirthdayToday =
    birthday.getUTCMonth() === now.getUTCMonth() &&
    birthday.getUTCDate() === now.getUTCDate();
  const currentYear = now.getFullYear();

  if (!isBirthdayToday || card.lastBirthdayBonusYear === currentYear) {
    return { card, birthdayBonusGranted: false };
  }

  const updated = await PizzaCard.findOneAndUpdate(
    { _id: card._id, lastBirthdayBonusYear: { $ne: currentYear } },
    { $inc: { slicesRemaining: 1, totalSlices: 1 }, $set: { lastBirthdayBonusYear: currentYear } },
    { new: true }
  );

  return updated
    ? { card: updated, birthdayBonusGranted: true }
    : { card, birthdayBonusGranted: false };
}

app.get("/api/cards/:id", async (req, res) => {
  try {
    let card = await PizzaCard.findById(req.params.id);

    if (!card) {
      return res.status(404).json({ message: "Pizza card not found" });
    }

    const { card: updatedCard, birthdayBonusGranted } = await applyBirthdayBonusIfDue(card);

    res.json({ ...updatedCard.toObject(), birthdayBonusGranted });
  } catch (error) {
    handleError(res, error);
  }
});

app.patch("/api/cards/:id/redeem", authLimiter, requireStaff, async (req, res) => {
  try {
    const card = await PizzaCard.findOneAndUpdate(
      { _id: req.params.id, slicesRemaining: { $gt: 0 } },
      {
        $inc: { slicesRemaining: -1 },
        $push: { redemptions: { at: new Date(), by: req.staffRole } },
      },
      { new: true }
    );

    if (!card) {
      const exists = await PizzaCard.exists({ _id: req.params.id });
      return res.status(400).json({
        message: exists ? "No slices remaining" : "Pizza card not found",
      });
    }

    const shopStats = await ShopStats.findOneAndUpdate(
      { _id: "global" },
      { $inc: { totalRedemptions: 1 } },
      { upsert: true, new: true }
    );

    const reward = shopStats.totalRedemptions % 10 === 0 ? rollReward() : null;

    if (card.slicesRemaining === 0) {
      sendOwnerAlert(`🍕 ${card.customerName}'s card just hit 0 slices — reload opportunity!`);
    }

    const threshold = Number(process.env.DAILY_REDEMPTION_ALERT_THRESHOLD) || 50;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const redeemedToday = await countRedemptionsSince(startOfToday);

    if (redeemedToday === threshold) {
      sendOwnerAlert(`🎉 ${threshold} slices redeemed today at Saucies!`);
    }

    res.json({ ...card.toObject(), reward });

  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/cards/:id/qrcode", async (req, res) => {
  try {
    const card = await PizzaCard.findById(req.params.id);

    if (!card) {
      return res.status(404).json({
        message: "Pizza card not found"
      });
    }

    const customerPageUrl =
  `${process.env.BASE_URL}/customer.html?id=${card._id}`;

    QRCode.toDataURL(customerPageUrl, (err, url) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          message: "Could not generate QR code"
        });
      }

      res.json({
        qrCode: url
      });
    });

  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/stats", requireAdmin, async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const [activeCards, totalCards, redemptionStats] = await Promise.all([
      PizzaCard.countDocuments({ slicesRemaining: { $gt: 0 } }),
      PizzaCard.countDocuments({}),
      PizzaCard.aggregate([
        { $unwind: "$redemptions" },
        { $group: {
          _id: null,
          redeemedToday: { $sum: { $cond: [{ $gte: ["$redemptions.at", startOfToday] }, 1, 0] } },
          redeemedThisWeek: { $sum: { $cond: [{ $gte: ["$redemptions.at", startOfWeek] }, 1, 0] } },
        } },
      ]),
    ]);

    res.json({
      activeCards,
      totalCards,
      redeemedToday: redemptionStats[0]?.redeemedToday || 0,
      redeemedThisWeek: redemptionStats[0]?.redeemedThisWeek || 0,
    });
  } catch (error) {
    handleError(res, error);
  }
});

const PORT = process.env.LEGACY_PORT || 3001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});