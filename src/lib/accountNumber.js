const crypto = require("crypto");

// A 7-digit account number: 6 random digits plus a Luhn check digit. The check
// digit means a mistyped number at the register is rejected instead of
// silently punching someone else's card. 6 random digits give ~1,000,000
// possible cards; generation retries on collision (see routes).

function luhnCheckDigit(body) {
  let sum = 0;
  // Walk right to left; the check digit will sit to the right of `body`, so
  // the rightmost body digit is in a "doubled" position.
  for (let i = body.length - 1, double = true; i >= 0; i--, double = !double) {
    let digit = Number(body[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10;
}

function generate() {
  const body = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  return body + luhnCheckDigit(body);
}

// Accepts "123-4567", "123 4567", " 1234567 " etc. Returns the 7 digits, or null.
function normalize(input) {
  const digits = String(input ?? "").replace(/[\s-]/g, "");
  return /^\d{7}$/.test(digits) ? digits : null;
}

function isValid(input) {
  const digits = normalize(input);
  if (!digits) return false;
  return luhnCheckDigit(digits.slice(0, 6)) === Number(digits[6]);
}

function format(digits) {
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

module.exports = { generate, normalize, isValid, format, luhnCheckDigit };
