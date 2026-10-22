const mongoose = require("mongoose");

const redemptionSchema = new mongoose.Schema({
  at: {
    type: Date,
    default: Date.now,
  },
  by: {
    type: String,
    enum: ["admin", "staff"],
    required: true,
  },
}, { _id: false });

const pizzaCardSchema = new mongoose.Schema({
  customerName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },

  totalSlices: {
    type: Number,
    default: 10,
  },

  slicesRemaining: {
    type: Number,
    default: 10,
  },

  redemptions: {
    type: [redemptionSchema],
    default: [],
  },

  groupName: {
    type: String,
    trim: true,
    maxlength: 100,
  },

  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "PizzaCard",
  },

  birthday: {
    type: Date,
  },

  lastBirthdayBonusYear: {
    type: Number,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  }
});

module.exports = mongoose.model("PizzaCard", pizzaCardSchema);