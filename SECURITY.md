# Security model

## Version 0.1 (current): local-only, no accounts

EasyBeat Studio has no server, no login and makes no network requests. Your projects and
audio never leave your computer.

What is in place:

- **No secrets in the code.** There are no API keys, passwords or tokens anywhere in the
  repository, and none are needed. `.env` files are git-ignored in case one is added later.
- **Content-Security-Policy** on the production build (`vite.config.ts`): scripts only from
  the app itself, no external connections, no plugins/objects, no form posts.
- **No HTML injection.** The UI never uses `innerHTML`/`dangerouslySetInnerHTML`; assistant
  text is rendered as plain React text.
- **Input validation.**
  - Every project loaded from storage or a backup goes through `normalizeProject()`, which
    upgrades old formats, clamps numbers to safe ranges, strips control characters from
    names, drops broken notes/clips and removes references to missing tracks, patterns and
    audio. Newer, unknown formats are refused with a clear message.
  - Imported audio is checked for extension, MIME type and size (50 MB, 10 minutes, 64
    files per project) and must decode successfully before it is stored.
  - MIDI files are limited to 2 MB and parsed with bounds checks on every read.
  - Backup files are limited to 300 MB and must carry the EasyBeat backup marker.
  - Download file names are sanitized for Windows.
- **Non-destructive storage.** Backups always import as a *new* project. IndexedDB upgrades
  are additive only. Deleting a project asks for confirmation.
- **Microphone** access is requested only when you press Record, and the stream is closed
  as soon as recording stops.

## Step 4 plan: optional cloud accounts (not implemented)

Accounts are **not required** and were intentionally not built for the first version: they
would need a server, hosting and configuration, which conflicts with "runs locally for
free". If cloud sync is added later, the plan is:

1. **Use an established auth provider, never custom password storage.** Options and
   trade-offs:
   - *Self-hosted* (e.g. FastAPI + a vetted library such as Authlib, or a self-hosted
     Keycloak/Supabase instance): free, but you run and patch the server.
   - *Hosted* (Supabase Auth, Firebase Auth, Auth0, Clerk): fast to set up, free tiers exist,
     but needs an account, configuration and possibly payment at scale.
   The choice should be made by the project owner before any code is written.
2. **Sessions:** short-lived access tokens + refresh tokens in `HttpOnly`, `Secure`,
   `SameSite=Lax` cookies. No tokens in `localStorage`.
3. **Server-side authorization:** every project/audio request checks that the signed-in
   user owns the resource (or row-level security policies in the database).
4. **Secrets** live only in server environment variables / a secret manager, never in the
   frontend bundle or git.
5. **Validation & rate limiting** on every endpoint (reuse `normalizeProject()` and the file
   rules on the server), size limits on uploads, rate limits on login and upload routes.
6. **Web protections:** HTTPS only, CSRF protection for cookie-authenticated requests, strict
   CSP, CORS limited to the app's origin.
7. **Account lifecycle:** clear sign-out (revokes refresh token), and account deletion that
   removes the user's projects and audio from storage.
8. **Consent:** audio is uploaded only when the user explicitly turns on cloud sync for a
   project.

The storage layer is already split behind the `ProjectStore` / `AssetStore` interfaces
(`src/storage/stores.ts`), so a cloud implementation can be added without touching the audio
engine or the UI.

## Reporting a problem

Open an issue in the GitHub repository with steps to reproduce. Please do not include
personal audio or private projects in public issues.
