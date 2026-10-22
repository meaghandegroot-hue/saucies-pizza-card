// Saucies pizza loyalty: buy 9 pizzas, the 10th is free.
// The previous slice-card system is kept, dormant, in ./legacy (npm run legacy).
const { loadEnv, fromEnv } = require("./src/config");
loadEnv();

const mongoose = require("mongoose");
const { createApp } = require("./src/app");
const { createMailer } = require("./src/lib/mailer");

const config = fromEnv();

if (!config.adminKey && !config.staffKey) {
  console.error("Set ADMIN_KEY and/or STAFF_KEY in .env, or nobody can use the register.");
  process.exit(1);
}
if (!config.baseUrl) {
  console.warn("BASE_URL is not set: QR codes and email links will use the address of the request.");
}

const app = createApp({ config, mailer: createMailer() });
const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    return mongoose.model("LoyaltyCard").init(); // build indexes before taking requests
  })
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => console.log(`Saucies loyalty running on http://localhost:${PORT}`));
  })
  .catch((error) => {
    console.error("Could not start:", error.message);
    process.exit(1);
  });
