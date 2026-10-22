// Sends transactional email. Uses Resend (https://resend.com) when
// RESEND_API_KEY and MAIL_FROM are set. Without them it only prints the
// message to the server console, so the whole flow can be tried locally
// before an email provider is chosen. In production it refuses to pretend.

function createMailer(env = process.env) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM;
  const isProd = env.NODE_ENV === "production";

  return {
    async send({ to, subject, text, html }) {
      if (!apiKey || !from) {
        if (isProd) {
          throw new Error("Email is not configured (set RESEND_API_KEY and MAIL_FROM).");
        }
        console.log(`\n[email not sent: no provider configured]\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
        return { delivered: false, devOnly: true };
      }

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: [to], subject, text, html }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Email provider rejected the message (${response.status}) ${detail.slice(0, 200)}`);
      }
      return { delivered: true };
    },
  };
}

module.exports = { createMailer };
