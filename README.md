# saucies-pizza-card

Loyalty cards for Saucies: **buy 9 pizzas, the 10th is free.** Node, Express and
MongoDB Atlas. The staff register is a web page on a phone at the counter.

## How it works

- **Only the register creates cards.** Staff sign in with a staff key, tap *New card*,
  and the phone shows a QR code and a 7-digit number. The customer points their own
  phone camera at the QR to keep their card page.
- **Scanning or typing.** Staff scan the QR off the customer's screen, or type the
  7-digit number (the last digit is a check digit, so typos are rejected) or the
  customer's email.
- **Punching.** Staff enter how many pizzas were bought. Extra pizzas carry over, so
  nothing is lost when someone buys three at once. A second punch within 5 minutes asks
  staff to confirm it's a second order.
- **Optional email.** With the customer's agreement (the notice is shown on the register
  and the wording version is stored), a confirmation link is emailed. Once confirmed, the
  customer's page shows their countdown. Every email has a "remove my email" link.
- **The free pizza.** Cards with a confirmed email need a 6-digit code emailed to the
  customer. Staff can approve without it (with a reason, logged) unless
  `ALLOW_FREE_OVERRIDE=false`. Cards without an email need staff approval.
- **Safe with two devices.** Every change is checked against the card's latest version,
  so two phones can't double-redeem a free pizza or lose a punch.

Pages: `/register` (staff), `/c/<card>` (customer), `/verify`, `/remove-email`.

## Run it

```bash
cp .env.example .env     # fill in MONGO_URI, BASE_URL, STAFF_KEY, ADMIN_KEY
npm install
npm start
npm test                 # uses a throwaway in-memory database, never your real one
```

The server must be reachable on the public internet over HTTPS: the customer opens
the email link on cellular data, and phone cameras only work on HTTPS pages.
The register phone can be on the shop's wifi like any other browser.

Emails use [Resend](https://resend.com) (`RESEND_API_KEY`, `MAIL_FROM`). Until those are
set, emails are printed to the server console so the flow can be tried.

## Legacy system

The original slice-card app (10 slices, referrals, birthdays, group cards, mystery
rewards, owner alerts) is kept untouched in [`legacy/`](legacy). It is not loaded by the
main server. To run it on its own: `npm run legacy` (port 3001, same database,
different collections).

## Notes for the owner

- The consent wording lives in `src/config.js` (`consentText`). Change it, and bump
  `CONSENT_VERSION` so each customer's agreed version stays on record. Have the wording
  checked against the rules where the shop operates (e.g. CASL in Canada).
- 7-digit numbers allow about a million cards.
