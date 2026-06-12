const mongoose = require("mongoose");

const pizzaCardSchema = new mongoose.Schema({
  customerName: {
    type: String,
    required: true,
  },

  slicesRemaining: {
    type: Number,
    default: 10,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  }
});

module.exports = mongoose.model("PizzaCard", pizzaCardSchema);