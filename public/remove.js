// /remove-email#<card id>: asks first (so a mail scanner opening the link
// can't remove anything), then deletes the email and consent record.
(() => {
  const app = document.getElementById("app");
  const publicId = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);

  function make(tag, props = {}) { return Object.assign(document.createElement(tag), props); }
  function show(...nodes) { app.replaceChildren(...nodes); }

  if (!publicId) {
    show(make("h1", { textContent: "Link not valid" }), make("p", { className: "msg error", textContent: "This link is missing its code. Open it again from your email." }));
    return;
  }

  const button = make("button", { className: "btn primary big", type: "button", textContent: "Remove my email" });
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await fetch("/api/public/remove-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId }),
      });
      if (!response.ok) throw new Error("failed");
      show(
        make("h1", { textContent: "Email removed" }),
        make("p", { className: "msg ok", textContent: "We've deleted your email from your card. Your pizza count stays; you just won't see the countdown or get emails." })
      );
    } catch {
      button.disabled = false;
      show(
        make("h1", { textContent: "Remove my email" }),
        make("p", { className: "msg error", textContent: "That didn't work. Try again, or ask staff to remove it." }),
        button
      );
    }
  });

  show(
    make("h1", { textContent: "Remove my email?" }),
    make("p", { textContent: "We'll delete the email address from your pizza card. You'll keep your pizza count." }),
    button
  );
})();
