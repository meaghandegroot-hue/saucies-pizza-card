const API_URL = window.location.origin;

function getStaffKey() {
  let key = sessionStorage.getItem("staffKey");

  if (!key) {
    key = prompt("Enter staff passcode:");
    if (key) sessionStorage.setItem("staffKey", key);
  }

  return key;
}

async function findCard() {
  const cardId = document.getElementById("cardId").value.trim();

  const response = await fetch(`${API_URL}/api/cards/${cardId}`);
  const card = await response.json();

  if (!response.ok) {

    alert(card.message || card.error || "Could not find card");

    return;

  }

  displayCard(card);
}

async function redeemSlice(id) {
  const response = await fetch(`${API_URL}/api/cards/${id}/redeem`, {
    method: "PATCH",
    headers: { "x-staff-key": getStaffKey() }
  });

  if (response.status === 401) {
    sessionStorage.removeItem("staffKey");
    alert("Incorrect staff passcode");
    return;
  }

  const card = await response.json();

  if (!response.ok) {
    alert(card.message || card.error || "Could not redeem slice");
    return;
  }

  displayCard(card);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function displayCard(card) {
  document.getElementById("cardDisplay").innerHTML = `
    <h2>${escapeHtml(card.customerName)}'s Pizza Card</h2>
    <p><strong>Slices Remaining:</strong> ${card.slicesRemaining}</p>
    <button onclick="redeemSlice('${card._id}')">Redeem 1 Slice</button>
  `;
}