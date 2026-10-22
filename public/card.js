// The customer's own page: their QR, backup number, and (once their email is
// confirmed) the pizza countdown.
(() => {
  const app = document.getElementById("app");
  const publicId = location.pathname.split("/").filter(Boolean)[1] || "";

  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (name === "class") node.className = value;
      else if (name === "text") node.textContent = value;
      else node.setAttribute(name, value === true ? "" : value);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return node;
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  function countdownBlock(c) {
    const ready = c.freeAvailable > 0;
    const filled = ready ? c.pizzasForFree : c.towardNext;
    return [
      ready ? el("div", { class: "ready-banner", text: c.freeAvailable > 1 ? `${c.freeAvailable} free pizzas ready` : "Your free pizza is ready" }) : null,
      el("div", { class: "dots", "aria-hidden": "true" },
        Array.from({ length: c.pizzasForFree }, (_, i) => el("div", { class: i < filled ? "dot on" : "dot" }))),
      el("p", { text: ready
        ? "Show this card at the counter to redeem it."
        : `${plural(c.pizzasUntilFree, "pizza")} until your free one.` }),
    ];
  }

  async function load() {
    let response;
    try {
      response = await fetch(`/api/public/cards/${encodeURIComponent(publicId)}`);
    } catch {
      app.replaceChildren(el("p", { class: "msg error", text: "No connection. Try again in a moment." }));
      return;
    }
    if (!response.ok) {
      app.replaceChildren(el("p", { class: "msg error", text: "We couldn't find this card. Ask staff for help." }));
      return;
    }
    const card = await response.json();
    document.title = `${card.shopName} pizza card`;

    const countdown = card.countdown
      ? countdownBlock(card.countdown)
      : [el("p", {
          text: card.emailStatus === "pending"
            ? "Check your email and tap the link to confirm it. Your countdown will show up here."
            : "Want to see how many pizzas until your free one? Ask staff to add your email.",
        })];

    app.replaceChildren(
      el("section", { class: "hero-card" },
        el("div", {},
          el("div", { class: "title", text: `${card.shopName} pizza card` }),
          card.customerName ? el("div", { text: card.customerName }) : null),
        ...countdown
      ),
      el("section", { class: "panel" },
        el("h2", { text: "Show this at the counter" }),
        el("img", { class: "qr", src: `/api/public/cards/${encodeURIComponent(publicId)}/qr.png`, alt: "Your card's QR code" }),
        el("div", { class: "number mono", text: card.accountNumberFormatted }),
        el("p", { class: "small dim center", text: "Save a screenshot of this page, or bookmark it. If the code won't scan, tell staff the number above." })
      )
    );
  }

  load();
})();
