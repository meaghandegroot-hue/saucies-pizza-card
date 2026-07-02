const API_URL = window.location.origin;

function getAdminKey() {
  let key = sessionStorage.getItem("adminKey");

  if (!key) {
    key = prompt("Enter admin passcode:");
    if (key) sessionStorage.setItem("adminKey", key);
  }

  return key;
}

let html5QrCode;

function startScan() {
  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("qr-reader");
  }

  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 250 },
    onScanSuccess
  );
}

function stopScan() {
  if (html5QrCode) {
    html5QrCode.stop();
  }
}

function onScanSuccess(decodedText) {
  stopScan();

  document.getElementById("cardId").value = extractCardId(decodedText);
  findCard();
}

function extractCardId(text) {
  try {
    return new URL(text).searchParams.get("id") || text;
  } catch {
    return text;
  }
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

async function createCard() {
  const customerName = document.getElementById("customerName").value;

  const response = await fetch(`${API_URL}/api/cards`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-staff-key": getAdminKey()
    },
    body: JSON.stringify({ customerName })
  });

  if (response.status === 401) {
    sessionStorage.removeItem("adminKey");
    alert("Incorrect admin passcode");
    return;
  }

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
    method: "PATCH",
    headers: { "x-staff-key": getAdminKey() }
  });

  if (response.status === 401) {
    sessionStorage.removeItem("adminKey");
    alert("Incorrect admin passcode");
    return;
  }

  const card = await response.json();
  displayCard(card);
}

function displayCard(card) {
  const cardDisplay = document.getElementById("cardDisplay");

  cardDisplay.innerHTML = `
    <h2>${escapeHtml(card.customerName)}'s Pizza Card</h2>
    <p><strong>Card ID:</strong> ${card._id}</p>
    <p><strong>Slices Remaining:</strong> ${card.slicesRemaining}</p>
    <button onclick="redeemSlice('${card._id}')">Redeem 1 Slice</button>
  `;
}