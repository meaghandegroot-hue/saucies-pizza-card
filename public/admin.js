const API_URL = window.location.origin;

async function createCard() {
  const customerName = document.getElementById("customerName").value;

  const response = await fetch(`${API_URL}/api/cards`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ customerName })
  });

  const card = await response.json();
  displayCard(card);
}

async function findCard() {
  const cardId = document.getElementById("cardId").value;

  const response = await fetch(`${API_URL}/api/cards/${cardId}`);
  const card = await response.json();

  displayCard(card);
}

async function redeemSlice(id) {
  const response = await fetch(`${API_URL}/api/cards/${id}/redeem`, {
    method: "PATCH"
  });

  const card = await response.json();
  displayCard(card);
}

function displayCard(card) {
  const cardDisplay = document.getElementById("cardDisplay");

  cardDisplay.innerHTML = `
    <h2>${card.customerName}'s Pizza Card</h2>
    <p><strong>Card ID:</strong> ${card._id}</p>
    <p><strong>Slices Remaining:</strong> ${card.slicesRemaining}</p>
    <button onclick="redeemSlice('${card._id}')">Redeem 1 Slice</button>
  `;
}