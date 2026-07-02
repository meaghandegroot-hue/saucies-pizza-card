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

  document.getElementById("customerCard").innerHTML = `
    <h2>${escapeHtml(card.customerName)}'s Pizza Card</h2>
    <p><strong>Slices Remaining:</strong> ${card.slicesRemaining}</p>
    <p><strong>Card ID:</strong> ${card._id}</p>
  `;
}

loadCustomerCard();