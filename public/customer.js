const API_URL = window.location.origin;

const params = new URLSearchParams(window.location.search);
const cardId = params.get("id");

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

async function loadCustomerCard() {
  const response = await fetch(`${API_URL}/api/cards/${cardId}`);
  const card = await response.json();

  if (!response.ok) {
    document.getElementById("customerCard").innerHTML =
      `<p>${escapeHtml(card.message || "Could not load card")}</p>`;
    return;
  }

  const total = card.totalSlices || 10;
  const percent = Math.max(0, Math.min(100, (card.slicesRemaining / total) * 100));

  let banner = "";
  if (card.birthdayBonusGranted) {
    banner = `<p class="low-slices-banner">🎉 Happy Birthday! We added a free slice to your card.</p>`;
  } else if (card.slicesRemaining <= 0) {
    banner = `<p class="low-slices-banner">Your card is empty — grab a refill! 🍕</p>`;
  } else if (card.slicesRemaining <= 2) {
    banner = `<p class="low-slices-banner">Almost time for a refill! 🍕</p>`;
  }

  const groupLine = card.groupName
    ? `<p><strong>Shared group card:</strong> ${escapeHtml(card.groupName)}</p>`
    : "";

  const history = [...(card.redemptions || [])].reverse();
  const historyList = history.length
    ? `<ul class="history-list">${history.map(r => `<li>${formatRedemption(r)}</li>`).join("")}</ul>`
    : `<p class="history-empty">No slices redeemed yet.</p>`;

  document.getElementById("customerCard").innerHTML = `
    <h2>${escapeHtml(card.customerName)}'s Pizza Card</h2>
    ${groupLine}
    <div class="progress-track">
      <div class="progress-fill" style="width: ${percent}%"></div>
    </div>
    <p><strong>${card.slicesRemaining} of ${total} slices remaining</strong></p>
    ${banner}
    <p><strong>Card ID:</strong> ${card._id}</p>
    <h3>Redemption History</h3>
    ${historyList}
  `;
}

function formatRedemption(redemption) {
  const when = new Date(redemption.at).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${escapeHtml(when)} — 1 slice — Saucies counter`;
}

loadCustomerCard();