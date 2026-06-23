const API_URL = window.location.origin;

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
    method: "PATCH"
  });

  if (!response.ok) {

    alert(card.message || card.error || "Could not redeem slice");

    return;

  }

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