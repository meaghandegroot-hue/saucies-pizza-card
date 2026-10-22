// The register phone: create cards, scan or look up, add pizzas, redeem free ones.
(() => {
  const KEY_STORE = "saucies.staffKey";
  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");

  let staffKey = store("get");
  let cfg = null;
  let scanner = null;

  // ---------- small helpers ----------

  function store(action, value) {
    try {
      if (action === "get") return localStorage.getItem(KEY_STORE) || "";
      if (action === "set") localStorage.setItem(KEY_STORE, value);
      if (action === "remove") localStorage.removeItem(KEY_STORE);
    } catch { /* private mode: key just won't be remembered */ }
    return "";
  }

  // Builds DOM without ever parsing strings as HTML, so names and emails
  // typed by customers can't inject markup.
  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (name === "class") node.className = value;
      else if (name === "text") node.textContent = value;
      else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
      else node.setAttribute(name, value === true ? "" : value);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return node;
  }

  let toastTimer;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  function stopScanner() {
    if (!scanner) return;
    const old = scanner;
    scanner = null;
    const SCANNING = 2, PAUSED = 3; // Html5QrcodeScannerState
    let running = false;
    try { running = [SCANNING, PAUSED].includes(old.getState()); } catch { /* not started */ }
    // stop() throws if the camera never started, so only call it when running.
    Promise.resolve(running ? old.stop() : null)
      .catch(() => {})
      .finally(() => { try { old.clear(); } catch { /* already cleared */ } });
  }

  function render(...nodes) {
    stopScanner();
    // Optional parts are passed as null; replaceChildren would print "null".
    app.replaceChildren(...nodes.filter(Boolean));
    window.scrollTo(0, 0);
  }

  async function api(method, path, body) {
    let response;
    try {
      response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json", "x-staff-key": staffKey },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, data: { message: "No connection. Check the wifi and try again." } };
    }
    let data = {};
    try { data = await response.json(); } catch { /* empty body */ }
    if (response.status === 401) {
      staffKey = "";
      store("remove");
      showLock(data.message || "Wrong staff key.");
    }
    return { ok: response.ok, status: response.status, data };
  }

  // Disables a button while its action runs, so a double tap can't act twice.
  async function busy(button, action) {
    if (button.disabled) return;
    button.disabled = true;
    try { await action(); } finally { button.disabled = false; }
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const timeText = (iso) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

  function message(kind, text) { return el("p", { class: `msg ${kind}`, role: kind === "error" ? "alert" : null, text }); }

  function header() {
    return el("div", { class: "bar" },
      el("span", { class: "brand", text: cfg ? cfg.shopName : "Register" }),
      el("button", { class: "link", type: "button", text: "Lock", onclick: () => { staffKey = ""; store("remove"); showLock(); } })
    );
  }

  // ---------- lock ----------

  function showLock(note) {
    cfg = null;
    const input = el("input", { type: "password", id: "key", autocomplete: "current-password", autocapitalize: "none" });
    const button = el("button", { class: "btn primary big", type: "submit", text: "Unlock" });
    const form = el("form", { class: "panel" },
      el("h1", { text: "Staff only" }),
      note ? message("error", note) : null,
      el("div", { class: "field" }, el("label", { for: "key", text: "Staff key" }), input),
      button
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      busy(button, async () => {
        staffKey = input.value.trim();
        const r = await api("GET", "/api/config");
        if (r.ok) { cfg = r.data; store("set", staffKey); showHome(); }
        else if (r.status !== 401) showLock(r.data.message || "Could not unlock.");
      });
    });
    render(form);
    input.focus();
  }

  // ---------- home ----------

  function showHome(note) {
    const q = el("input", { type: "text", id: "q", autocomplete: "off", autocapitalize: "none", placeholder: "Card number or email" });
    const find = el("button", { class: "btn fixed", type: "submit", text: "Find" });
    const form = el("form", { class: "row" }, q, find);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (q.value.trim()) busy(find, () => lookup(q.value.trim()));
    });

    render(
      header(),
      note ? message(note.kind || "error", note.text || note) : null,
      el("button", { class: "btn primary big", type: "button", text: "Scan a card", onclick: () => showScan() }),
      el("button", { class: "btn big", type: "button", text: "New card", onclick: () => showNew() }),
      el("section", { class: "panel" },
        el("h2", { text: "Scanning not working?" }),
        el("label", { class: "small dim", for: "q", text: "Type the 7-digit number or the customer's email" }),
        form
      )
    );
  }

  // ---------- lookup / scan ----------

  async function lookup(q) {
    const r = await api("GET", `/api/cards/lookup?q=${encodeURIComponent(q)}`);
    if (r.status === 401) return;
    if (!r.ok) return showHome(r.data.message || "Could not look that up.");
    if (r.data.cards.length === 1) return showCard(r.data.cards[0]);
    showResults(r.data.cards);
  }

  function showResults(cards) {
    render(
      header(),
      el("h1", { text: "Which card?" }),
      el("ul", { class: "results" }, cards.map((card) =>
        el("li", {},
          el("button", { class: "btn", type: "button", onclick: () => showCard(card) },
            el("div", { class: "mono", text: card.accountNumberFormatted }),
            el("div", { class: "small dim", text: `${card.customerName || "No name"} · ${plural(card.countdown.paidPizzas, "pizza")}` })
          )
        )
      )),
      el("button", { class: "link", type: "button", text: "Back", onclick: () => showHome() })
    );
  }

  function showScan(note) {
    const reader = el("div", { id: "reader" });
    render(
      header(),
      el("h1", { text: "Scan the customer's QR" }),
      note ? message("error", note) : null,
      reader,
      el("p", { class: "small dim center", text: "Hold the phone so the whole QR code is in the box." }),
      el("button", { class: "btn", type: "button", text: "Cancel", onclick: () => showHome() })
    );

    if (typeof Html5Qrcode === "undefined") return showHome("The scanner didn't load. Type the number instead.");
    const instance = new Html5Qrcode("reader");
    scanner = instance;
    instance.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (text) => {
        if (scanner !== instance) return; // already handled
        stopScanner();
        lookup(text);
      }
    ).catch(() => {
      if (scanner === instance) {
        showHome("The camera isn't available. Allow camera access, or type the number.");
      }
    });
  }

  // ---------- new card ----------

  function showNew() {
    const name = el("input", { type: "text", id: "name", maxlength: "100", autocomplete: "off", placeholder: "Optional" });
    const email = el("input", { type: "email", id: "email", autocomplete: "off", autocapitalize: "none", placeholder: "Optional: shows their countdown" });
    const consent = el("input", { type: "checkbox", id: "consent" });
    const consentBox = el("div", { class: "hidden" },
      el("p", { class: "notice", text: cfg.consentText }),
      el("label", { class: "check", for: "consent" }, consent, el("span", { text: "The customer has read this and agrees." }))
    );
    const error = el("div");
    const submit = el("button", { class: "btn primary big", type: "submit", text: "Create card" });

    email.addEventListener("input", () => consentBox.classList.toggle("hidden", !email.value.trim()));

    const form = el("form", { class: "panel" },
      el("div", { class: "field" }, el("label", { for: "name", text: "Name" }), name),
      el("div", { class: "field" }, el("label", { for: "email", text: "Email" }), email),
      consentBox,
      error,
      submit
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      error.replaceChildren();
      if (email.value.trim() && !consent.checked) {
        error.append(message("error", "Tick the box once the customer has agreed to the email notice."));
        return;
      }
      busy(submit, async () => {
        const r = await api("POST", "/api/cards", {
          customerName: name.value.trim() || undefined,
          email: email.value.trim() || undefined,
          consent: email.value.trim() ? true : undefined,
        });
        if (r.status === 401) return;
        if (!r.ok) return error.replaceChildren(message("error", r.data.message || "Could not create the card."));
        showCreated(r.data);
      });
    });

    render(header(), el("h1", { text: "New card" }), form,
      el("button", { class: "link", type: "button", text: "Back", onclick: () => showHome() }));
  }

  function showCreated({ card, qr, emailSent }) {
    let emailNote = el("p", { class: "dim center", text: "No email. Staff can add one later from the card." });
    if (emailSent === true) emailNote = message("ok", `Confirmation sent to ${card.email}. Their countdown appears once they confirm.`);
    if (emailSent === false) emailNote = message("error", "The card is created, but the email didn't send. Open the card to send it again.");

    render(
      header(),
      el("h1", { class: "center", text: "Card ready" }),
      el("section", { class: "panel" },
        el("img", { class: "qr", src: qr, alt: "QR code for this card" }),
        el("div", { class: "number mono", text: card.accountNumberFormatted }),
        el("p", { class: "small dim center", text: "Customer: point your phone camera at this code to keep your card. If scanning ever fails, staff can type the number." })
      ),
      emailNote,
      el("button", { class: "btn primary big", type: "button", text: "Add their first pizzas", onclick: () => showCard(card) }),
      el("button", { class: "btn", type: "button", text: "Done", onclick: () => showHome() })
    );
  }

  // ---------- a card ----------

  function countdownBlock(card) {
    const c = card.countdown;
    const ready = c.freeAvailable > 0;
    const dots = el("div", { class: ready ? "dots ready" : "dots", "aria-hidden": "true" },
      Array.from({ length: c.pizzasForFree }, (_, i) => el("div", { class: i < (ready ? c.pizzasForFree : c.towardNext) ? "dot on" : "dot" }))
    );
    const main = ready
      ? [el("div", { class: "big", text: c.freeAvailable > 1 ? `${c.freeAvailable} free pizzas ready` : "Free pizza ready" }),
         c.towardNext ? el("div", { class: "label", text: `+ ${plural(c.towardNext, "pizza")} toward the next` }) : null]
      : [el("div", { class: "big", text: String(c.pizzasUntilFree) }),
         el("div", { class: "label", text: `${c.pizzasUntilFree === 1 ? "pizza" : "pizzas"} until the free one` })];
    return el("section", { class: ready ? "panel countdown ready" : "panel countdown" }, ...main, dots);
  }

  function emailChip(card) {
    if (card.emailStatus === "verified") return el("span", { class: "chip good", text: `Email confirmed · ${card.email}` });
    if (card.emailStatus === "pending") return el("span", { class: "chip warn", text: `Waiting for them to confirm · ${card.email}` });
    return el("span", { class: "chip", text: "No email" });
  }

  function describeEvent(e) {
    if (e.type === "punch") return `Added ${plural(e.qty, "pizza")}${e.note ? ` (${e.note})` : ""}`;
    if (e.type === "free") return `Free pizza${e.note ? `: ${e.note}` : ""}`;
    if (e.type === "undo") return "Undid the last change";
    return e.note || "Email changed";
  }

  function showCard(card, note) {
    const max = cfg.maxPunchQty;
    let qty = 1;
    const qtyNum = el("div", { class: "num", "aria-live": "polite", text: "1" });
    const addBtn = el("button", { class: "btn primary big", type: "button", text: "Add 1 pizza" });
    const feedback = el("div");

    function setQty(n) {
      qty = Math.min(max, Math.max(1, n));
      qtyNum.textContent = String(qty);
      addBtn.textContent = `Add ${plural(qty, "pizza")}`;
    }
    const minus = el("button", { class: "btn", type: "button", "aria-label": "One fewer pizza", text: "−", onclick: () => setQty(qty - 1) });
    const plus = el("button", { class: "btn", type: "button", "aria-label": "One more pizza", text: "+", onclick: () => setQty(qty + 1) });

    async function punch(force) {
      const r = await api("POST", `/api/cards/${card.accountNumber}/punch`, { qty, force });
      if (r.status === 401) return;
      if (r.status === 409 && r.data.code === "RECENT_PUNCH") {
        const yes = el("button", { class: "btn primary", type: "button", text: "Yes, second order" });
        const no = el("button", { class: "btn", type: "button", text: "Cancel", onclick: () => feedback.replaceChildren() });
        yes.addEventListener("click", () => busy(yes, () => punch(true)));
        feedback.replaceChildren(
          el("div", { class: "panel" },
            message("error", `This card was punched ${r.data.secondsAgo < 90 ? `${r.data.secondsAgo} seconds` : `${Math.round(r.data.secondsAgo / 60)} minutes`} ago. Is this a second order?`),
            el("div", { class: "row" }, no, yes))
        );
        return;
      }
      if (!r.ok) return feedback.replaceChildren(message("error", r.data.message || "Could not add pizzas."));
      toast(r.data.freeJustEarned ? "Free pizza earned!" : `Added ${plural(qty, "pizza")}`);
      showCard(r.data.card);
    }
    addBtn.addEventListener("click", () => busy(addBtn, () => punch(false)));

    // ----- free pizza -----
    let freePanel = null;
    if (card.countdown.freeAvailable > 0) {
      const verified = card.emailStatus === "verified";
      const finish = (r) => {
        if (r.status === 401) return;
        if (!r.ok) return feedback.replaceChildren(message("error", r.data.message || "Could not redeem."));
        toast("Free pizza redeemed");
        showCard(r.data.card);
      };

      if (verified) {
        const code = el("input", { type: "text", inputmode: "numeric", maxlength: "6", autocomplete: "one-time-code", id: "code", placeholder: "6-digit code" });
        const send = el("button", { class: "btn", type: "button", text: "Email a code to the customer" });
        send.addEventListener("click", () => busy(send, async () => {
          const r = await api("POST", `/api/cards/${card.accountNumber}/free/request-code`);
          if (r.status === 401) return;
          if (!r.ok) return feedback.replaceChildren(message("error", r.data.message));
          feedback.replaceChildren(message("ok", `Code sent to ${r.data.to}. It lasts ${r.data.expiresInMinutes} minutes.`));
          code.focus();
        }));
        const redeem = el("button", { class: "btn good", type: "button", text: "Redeem with code" });
        redeem.addEventListener("click", () => busy(redeem, async () => {
          if (!/^\d{6}$/.test(code.value.trim())) return feedback.replaceChildren(message("error", "Enter the 6-digit code."));
          finish(await api("POST", `/api/cards/${card.accountNumber}/free`, { code: code.value.trim() }));
        }));

        const reason = el("input", { type: "text", maxlength: "150", id: "reason", placeholder: "Why? e.g. phone died" });
        const approve = el("button", { class: "btn", type: "button", text: "Approve without code" });
        approve.addEventListener("click", () => busy(approve, async () => {
          if (reason.value.trim().length < 3) return feedback.replaceChildren(message("error", "Add a short reason."));
          finish(await api("POST", `/api/cards/${card.accountNumber}/free`, { approved: true, reason: reason.value.trim() }));
        }));

        freePanel = el("section", { class: "panel" },
          el("h2", { text: "Free pizza" }),
          send,
          el("div", { class: "field" }, el("label", { for: "code", text: "Code the customer reads out" }), code),
          redeem,
          cfg.allowFreeOverride
            ? el("details", {}, el("summary", { class: "small dim", text: "Customer can't get the code" }),
                el("div", { class: "field", style: "margin-top:.6rem" }, reason), el("div", { style: "margin-top:.6rem" }, approve))
            : null
        );
      } else {
        const approve = el("button", { class: "btn good big", type: "button", text: "Approve free pizza" });
        approve.addEventListener("click", () => busy(approve, async () => {
          if (!window.confirm("Give this customer their free pizza?")) return;
          finish(await api("POST", `/api/cards/${card.accountNumber}/free`, { approved: true }));
        }));
        freePanel = el("section", { class: "panel" },
          el("h2", { text: "Free pizza" }),
          el("p", { class: "small dim", text: card.emailStatus === "pending"
            ? "Their email isn't confirmed yet, so staff approve this one."
            : "No email on this card, so staff approve it. Add an email below to protect the card next time." }),
          approve
        );
      }
    }

    // ----- email -----
    const emailInput = el("input", { type: "email", id: "card-email", autocomplete: "off", autocapitalize: "none", placeholder: "customer@example.com" });
    const consent = el("input", { type: "checkbox", id: "card-consent" });
    const saveEmail = el("button", { class: "btn", type: "button", text: card.emailStatus === "none" ? "Save and send confirmation" : "Save and send a new link" });
    saveEmail.addEventListener("click", () => busy(saveEmail, async () => {
      if (!emailInput.value.trim()) return feedback.replaceChildren(message("error", "Enter their email."));
      if (!consent.checked) return feedback.replaceChildren(message("error", "Tick the box once the customer has agreed."));
      const r = await api("POST", `/api/cards/${card.accountNumber}/email`, { email: emailInput.value.trim(), consent: true });
      if (r.status === 401) return;
      if (!r.ok) return feedback.replaceChildren(message("error", r.data.message));
      toast(r.data.emailSent ? "Confirmation email sent" : "Saved, but the email didn't send");
      showCard(r.data.card, r.data.emailSent ? null : "The email didn't send. Try \"Save and send\" again in a moment.");
    }));
    const removeEmail = card.emailStatus !== "none"
      ? el("button", { class: "link", type: "button", text: "Remove this email", onclick: async (event) => {
          if (!window.confirm("Remove the email from this card?")) return;
          busy(event.currentTarget, async () => {
            const r = await api("POST", `/api/cards/${card.accountNumber}/email/remove`);
            if (r.ok) { toast("Email removed"); showCard(r.data.card); }
          });
        } })
      : null;
    const emailPanel = el("details", { class: "panel" },
      el("summary", { text: card.emailStatus === "none" ? "Add an email" : "Change email" }),
      el("div", { class: "field" }, el("label", { for: "card-email", text: "Email" }), emailInput),
      el("p", { class: "notice", text: cfg.consentText }),
      el("label", { class: "check", for: "card-consent" }, consent, el("span", { text: "The customer has read this and agrees." })),
      saveEmail,
      removeEmail
    );

    // ----- QR for reprints -----
    const qrHolder = el("div");
    const qrPanel = el("details", { class: "panel" }, el("summary", { text: "Show the QR again" }), qrHolder);
    qrPanel.addEventListener("toggle", async () => {
      if (!qrPanel.open || qrHolder.childNodes.length) return;
      const r = await api("GET", `/api/cards/${card.accountNumber}/qr`);
      if (r.ok) qrHolder.append(el("img", { class: "qr", src: r.data.qr, alt: "QR code for this card" }));
    });

    // ----- undo + history -----
    const undo = card.canUndo
      ? el("button", { class: "btn", type: "button", text: "Undo last change", onclick: (event) => {
          if (!window.confirm("Undo the most recent change on this card?")) return;
          busy(event.currentTarget, async () => {
            const r = await api("POST", `/api/cards/${card.accountNumber}/undo`);
            if (r.status === 401) return;
            if (!r.ok) return feedback.replaceChildren(message("error", r.data.message));
            toast("Undone");
            showCard(r.data.card);
          });
        } })
      : null;

    const history = card.recentEvents.length
      ? el("ul", { class: "log" }, card.recentEvents.map((e) =>
          el("li", {}, el("span", { text: describeEvent(e) }), el("span", { class: "when", text: timeText(e.at) }))))
      : el("p", { class: "dim small", text: "Nothing yet." });

    render(
      header(),
      el("div", {},
        el("h1", { text: card.customerName || "Pizza card" }),
        el("div", { class: "mono dim", text: card.accountNumberFormatted }),
        el("div", { style: "margin-top:.5rem" }, emailChip(card))
      ),
      note ? message("error", note) : null,
      countdownBlock(card),
      freePanel,
      el("section", { class: "panel" },
        el("h2", { text: "Pizzas bought" }),
        el("div", { class: "stepper" }, minus, qtyNum, plus),
        addBtn
      ),
      feedback,
      emailPanel,
      qrPanel,
      undo,
      el("section", { class: "panel" }, el("h2", { text: "Recent activity" }), history),
      el("button", { class: "btn", type: "button", text: "Done", onclick: () => showHome() })
    );
  }

  // ---------- start ----------

  async function start() {
    if (!staffKey) return showLock();
    const r = await api("GET", "/api/config");
    if (r.ok) { cfg = r.data; showHome(); }
    else if (r.status !== 401) showLock(r.data.message || "Could not reach the server.");
  }

  start();
})();
