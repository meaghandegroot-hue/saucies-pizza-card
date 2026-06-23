const API_URL = window.location.origin;

async function createCard() {
  const customerName =
    document.getElementById("customerName").value;

  const response = await fetch(`${API_URL}/api/cards`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      customerName
    })
  });

  const card = await response.json();

console.log("response status:", response.status);
console.log("created card:", card);

if (!response.ok) {
  alert(card.error || card.message || "Server error creating card");
  return;
}

if (!card._id) {
  alert("Card did not save correctly");
  return;
}
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
  const cardDisplay =
    document.getElementById("cardDisplay");

  if (!card || !card._id) {
    cardDisplay.innerHTML =
      "<p>Could not load card</p>";
    return;
  }

  fetch(`${API_URL}/api/cards/${card._id}/qrcode`)
    .then(res => res.json())
    .then(data => {

      const qrImage = data.qrCode;

      cardDisplay.innerHTML = `
        <h2>${card.customerName}'s Pizza Card</h2>

        <p><strong>Card ID:</strong> ${card._id}</p>

        <p><strong>Slices Remaining:</strong>
        ${card.slicesRemaining}</p>

        <img src="${qrImage}" width="200">

        <br><br>

        <button onclick="redeemSlice('${card._id}')">
          Redeem 1 Slice
        </button>
      `;
    });
}