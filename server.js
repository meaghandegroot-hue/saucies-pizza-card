require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const QRCode = require("qrcode");

const PizzaCard = require("./models/PizzaCard");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

app.get("/", (req, res) => {
  res.send("Pizza Card Server Running");
});

app.post("/api/cards", async (req, res) => {
  try {

    const newCard = new PizzaCard({
      customerName: req.body.customerName,
    });

    await newCard.save();

    res.status(201).json(newCard);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/cards/:id", async (req, res) => {
  try {
    const card = await PizzaCard.findById(req.params.id);

    if (!card) {
      return res.status(404).json({ message: "Pizza card not found" });
    }

    res.json(card);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/cards/:id/redeem", async (req, res) => {
  try {

    const card = await PizzaCard.findById(req.params.id);

    if (!card) {
      return res.status(404).json({
        message: "Pizza card not found"
      });
    }

    if (card.slicesRemaining <= 0) {
      return res.status(400).json({
        message: "No slices remaining"
      });
    }

    card.slicesRemaining -= 1;

    await card.save();

    res.json(card);

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
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
        return res.status(500).json({
          error: err.message
        });
      }

      res.json({
        qrCode: url
      });
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});