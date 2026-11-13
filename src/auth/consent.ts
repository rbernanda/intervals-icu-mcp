import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
export function renderConsentPage(details: ConsentDescription, handle: string): string {
  const publisher = details.clientDomain
    ? `Client domain: <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : 'Client name is self-asserted.';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Authorize Intervals.icu access</title>
<body><main><h1>Allow ${escapeHtml(details.clientName)} to read your training data?</h1>
<p>${publisher} Access returns to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? '<p><strong>This sends access to an app on your computer. Continue only if you started this sign-in.</strong></p>' : ''}
<p>Grants read access to activities, fitness, wellness and calendar for the configured athlete. Only the configured GitHub account can approve. No Intervals write access is exposed.</p>
<p>Scopes: ${details.scope.map(escapeHtml).join(', ')}. Offline access, if requested, permits renewal for up to 30 days.</p>
<form method="post" action="/authorize"><input type="hidden" name="handle" value="${escapeHtml(handle)}">
${details.scope.map((scope) => `<input type="hidden" name="scope" value="${escapeHtml(scope)}">`).join('')}
<button name="decision" value="approve">Allow and sign in with GitHub</button> <button name="decision" value="deny">Deny</button></form></main></body></html>`;
}
