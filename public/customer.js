const API_URL = "http://10.0.0.206:3000";

const params = new URLSearchParams(window.location.search);
const cardId = params.get("id");

async function loadCustomerCard() {
  const response = await fetch(`${API_URL}/api/cards/${cardId}`);
  const card = await response.json();

  document.getElementById("customerCard").innerHTML = `
    <h2>${card.customerName}'s Pizza Card</h2>
    <p><strong>Slices Remaining:</strong> ${card.slicesRemaining}</p>
    <p><strong>Card ID:</strong> ${card._id}</p>
  `;
}

loadCustomerCard();