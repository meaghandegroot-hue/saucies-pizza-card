// The emailed link looks like /verify#<token>. The token sits in the URL
// fragment, so it is never sent to the server by the browser, logged, or
// passed on as a Referer. Email scanners that only fetch the page don't run
// this script, so they can't confirm an address by accident.
(async () => {
  const app = document.getElementById("app");
  const token = location.hash.slice(1);

  function show(kind, title, body, link) {
    const children = [
      Object.assign(document.createElement("h1"), { textContent: title }),
      Object.assign(document.createElement("p"), { className: `msg ${kind}`, textContent: body }),
    ];
    if (link) {
      const a = Object.assign(document.createElement("a"), { className: "btn primary", href: link, textContent: "Open my card" });
      a.style.textDecoration = "none";
      a.style.display = "grid";
      a.style.placeItems = "center";
      children.push(a);
    }
    app.replaceChildren(...children);
  }

  if (!token) return show("error", "Link not valid", "This link is missing its code. Open it again from your email.");

  try {
    const response = await fetch("/api/public/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) history.replaceState(null, "", location.pathname); // drop the token from the address bar
    if (response.ok) show("ok", "Email confirmed", "You're all set. Your pizza countdown is on your card page.", `/c/${data.publicId}`);
    else show("error", "Link not valid", data.message || "This link has expired. Ask staff to send a new one.");
  } catch {
    show("error", "No connection", "Check your signal and open the link again.");
  }
})();
