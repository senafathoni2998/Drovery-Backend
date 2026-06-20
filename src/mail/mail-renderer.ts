/**
 * Pure, dependency-free email rendering. The catalog already localizes the copy
 * ({placeholder} interpolation by I18nService); this only LAYS OUT the translated blocks
 * into a plaintext twin (the safe fallback — what every client can read) AND a minimal
 * inline-styled HTML twin (email clients strip <style>/external CSS, so styles are inline).
 * No template engine (Handlebars/MJML/EJS) — that would add the ICU/templating dependency
 * the rest of the app deliberately avoids. Dynamic values are HTML-escaped for the HTML twin.
 */
export interface EmailContent {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  codeHint: string; // already interpolated with the token
  signoff: string;
  footer: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderText(c: EmailContent): string {
  return [
    c.heading,
    '',
    c.body,
    '',
    `${c.ctaLabel}: ${c.ctaUrl}`,
    '',
    c.codeHint,
    '',
    c.signoff,
    c.footer,
  ].join('\n');
}

export function renderHtml(c: EmailContent): string {
  const h = escapeHtml;
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f4f5f7;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px">
        <tr><td>
          <h1 style="margin:0 0 16px;font-size:20px">${h(c.heading)}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#444444">${h(c.body)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#2563eb">
            <a href="${h(c.ctaUrl)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${h(c.ctaLabel)}</a>
          </td></tr></table>
          <p style="margin:24px 0 0;font-size:13px;color:#666666">${h(c.codeHint)}</p>
          <hr style="border:none;border-top:1px solid #eeeeee;margin:24px 0"/>
          <p style="margin:0;font-size:13px;color:#666666">${h(c.signoff)}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#999999">${h(c.footer)}</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;
}
