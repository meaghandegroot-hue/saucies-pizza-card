const mongoose = require("mongoose");

// Every change to a card is recorded here (last MAX_EVENTS kept on the card).
// `seq` is the card's eventSeq at the time, so an undo can point at exactly
// the event it reverses.
const eventSchema = new mongoose.Schema({
  seq: { type: Number, required: true },
  type: { type: String, enum: ["punch", "free", "undo", "email"], required: true },
  qty: { type: Number },
  undid: { type: Number }, // for type "undo": the seq being reversed
  at: { type: Date, default: Date.now },
  by: { type: String, enum: ["admin", "staff"], required: true },
  note: { type: String, maxlength: 200 },
}, { _id: false });

// A card holds paid-pizza punches. Every 9 paid pizzas earns 1 free pizza.
// Counts are not capped; see lib/countdown.js.
const loyaltyCardSchema = new mongoose.Schema({
  // Secret behind the QR code and the customer's page URL. Unguessable.
  publicId: { type: String, required: true, unique: true },

  // Human-friendly 7-digit number (with check digit) for when scanning fails.
  accountNumber: { type: String, required: true, unique: true, match: /^\d{7}$/ },

  customerName: { type: String, trim: true, maxlength: 100 },

  paidPizzas: { type: Number, default: 0, min: 0 },
  freeRedeemed: { type: Number, default: 0, min: 0 },
  lastPunchAt: { type: Date },

  // Bumped on every change; lets us detect two devices editing at once.
  eventSeq: { type: Number, default: 0 },
  events: { type: [eventSchema], default: [] },

  // ----- optional email (enables the customer's countdown) -----
  email: { type: String, lowercase: true, trim: true, maxlength: 254 },
  emailStatus: { type: String, enum: ["none", "pending", "verified"], default: "none" },
  emailVerifiedAt: { type: Date },
  consent: {
    version: { type: String },
    at: { type: Date },
  },
  // Only hashes of one-time secrets are stored.
  verifyTokenHash: { type: String },
  verifyExpiresAt: { type: Date },
  freeCode: {
    hash: { type: String },
    expiresAt: { type: Date },
    sentAt: { type: Date },
    attempts: { type: Number, default: 0 },
  },

  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String, enum: ["admin", "staff"] },
});

loyaltyCardSchema.index({ email: 1 }, { sparse: true });
loyaltyCardSchema.index({ verifyTokenHash: 1 }, { sparse: true });

const MAX_EVENTS = 100;

module.exports = mongoose.model("LoyaltyCard", loyaltyCardSchema, "loyalty_cards");
module.exports.MAX_EVENTS = MAX_EVENTS;
