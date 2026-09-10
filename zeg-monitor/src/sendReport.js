import { Resend } from "resend";

export async function sendReport(env, results) {
  const resend = new Resend(env.RESEND_API_KEY);
  const recipients = env.REPORT_RECIPIENTS.split(",").map((e) => e.trim());

  const overallOk = Object.values(results).every((r) => r === null || r.ok);
  const subject = overallOk
    ? "✅ ZEG site check: all clear"
    : "⚠️ ZEG site check: something needs attention";

  const html = buildHtml(results, overallOk);

  await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: recipients,
    subject,
    html,
  });
}

function buildHtml(results, overallOk) {
  const { transaction, defacement, speed, uptime } = results;

  const section = (title, bodyHtml) => `
    <tr><td style="padding:16px 0 4px;font-weight:600;font-size:15px;color:#222;">${title}</td></tr>
    <tr><td style="padding:0 0 12px;">${bodyHtml}</td></tr>
  `;

  const badge = (ok) =>
    ok
      ? `<span style="color:#0a7d2c;font-weight:600;">OK</span>`
      : `<span style="color:#c0392b;font-weight:600;">NEEDS ATTENTION</span>`;

  const row = (label, ok, detail) => `
    <div style="padding:4px 0;font-size:14px;color:#444;">
      ${badge(ok)} — ${label}${detail ? ` <span style="color:#888;">(${escapeHtml(detail)})</span>` : ""}
    </div>`;

  let body = "";

  // Payment flow
  body += section(
    "Payment & enrollment flow",
    transaction.steps.map((s) => row(s.name, s.ok, s.detail)).join("") +
      (transaction.error ? `<div style="color:#c0392b;font-size:13px;margin-top:4px;">Error: ${escapeHtml(transaction.error)}</div>` : "")
  );

  // Defacement
  body += section(
    "Page content integrity",
    defacement.pages.map((p) => row(p.path, p.ok, p.detail)).join("")
  );

  // Speed
  body += section(
    "Page speed (Core Web Vitals)",
    speed.pages.map((p) => row(p.path, p.ok, p.detail)).join("")
  );

  // Uptime (optional)
  if (uptime) {
    body += section(
      "Uptime",
      uptime.monitors.map((m) => row(m.name, m.ok, m.status)).join("")
    );
  }

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;">
    <h2 style="font-size:18px;color:#222;">ZEG Trust — Daily Site Report</h2>
    <p style="font-size:14px;color:#666;">
      ${overallOk ? "Everything checked out fine today." : "One or more checks need a look — see below."}
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">${body}</table>
    <p style="font-size:12px;color:#999;margin-top:24px;">
      Automated report from the ZEG site monitor. Questions? Contact Townsendsystems.
    </p>
  </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
