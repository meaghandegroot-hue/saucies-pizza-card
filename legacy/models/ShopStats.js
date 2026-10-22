const mongoose = require("mongoose");

// Singleton document (_id always "global") tracking shop-wide counters that
// don't belong to any one card — currently just the running redemption count
// used to roll the mystery-reward table every 10th slice.
const shopStatsSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: "global",
  },
  totalRedemptions: {
    type: Number,
    default: 0,
  },
});

module.exports = mongoose.model("ShopStats", shopStatsSchema);
