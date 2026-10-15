// Deprecated.
//
// The admin dashboard is now served as a static SPA at /admin (see
// netlify.toml for the rewrite, and admin.html / admin.js at the repo root).
// Its API lives at /api/admin/* (handled by api.mjs).
//
// This function is left as a stub to avoid a mystery 404 if any old link
// still targets the function URL directly. It deliberately has no
// `export const config`, so it does NOT register a route and cannot
// shadow the static page.

export default async () => new Response('This endpoint has moved to /admin.', {
  status: 410,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
});