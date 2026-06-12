const API_URL = "http://10.0.0.206:3000";

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
  document.getElementById("cardDisplay").innerHTML = `
    <h2>${card.customerName}'s Pizza Card</h2>
    <p><strong>Slices Remaining:</strong> ${card.slicesRemaining}</p>
    <button onclick="redeemSlice('${card._id}')">Redeem 1 Slice</button>
  `;
}