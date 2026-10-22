function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function layout(shopName, bodyHtml, removeUrl) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#1c1a1d;line-height:1.5">
  <h2 style="margin:0 0 12px">${esc(shopName)}</h2>
  ${bodyHtml}
  <p style="font-size:12px;color:#6a666b;margin-top:28px">
    You're getting this because someone registered this address on a ${esc(shopName)} pizza card.
    <a href="${esc(removeUrl)}">Remove my email</a>
  </p>
</div>`;
}

// Links use the URL #fragment (not ?query) so the secret is never sent to
// the server in a request line, logged, or passed along as a Referer.
function verification({ shopName, verifyUrl, removeUrl, cardUrl, accountNumber }) {
  const text =
    `Confirm your ${shopName} pizza card\n\n` +
    `Open this link to confirm your email and start seeing your pizza countdown:\n${verifyUrl}\n\n` +
    `Your card number: ${accountNumber}\nYour card page: ${cardUrl}\n\n` +
    `If this wasn't you, ignore this message, or remove your email: ${removeUrl}\n`;
  const html = layout(
    shopName,
    `<p>Confirm your email to start seeing your pizza countdown.</p>
     <p><a href="${esc(verifyUrl)}" style="display:inline-block;background:#c8321f;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Confirm my email</a></p>
     <p>Your card number: <b>${esc(accountNumber)}</b><br><a href="${esc(cardUrl)}">Open my card</a></p>`,
    removeUrl
  );
  return { subject: `Confirm your ${shopName} pizza card`, text, html };
}

function freeCode({ shopName, code, minutes, removeUrl }) {
  const text =
    `Your ${shopName} free pizza code is ${code}\n\n` +
    `Read it to the staff member to redeem your free pizza. It expires in ${minutes} minutes. ` +
    `If you didn't just ask for a free pizza, ignore this message.\n\nRemove my email: ${removeUrl}\n`;
  const html = layout(
    shopName,
    `<p>Your free pizza code:</p>
     <p style="font-size:32px;letter-spacing:6px;font-weight:bold;margin:8px 0">${esc(code)}</p>
     <p>Read it to the staff member. It expires in ${minutes} minutes.<br>If you didn't just ask for a free pizza, ignore this message.</p>`,
    removeUrl
  );
  return { subject: `Your ${shopName} free pizza code: ${code}`, text, html };
}

module.exports = { verification, freeCode };
