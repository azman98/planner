# Roadmap

Ideas and fixes for the app itself (life tasks go in the app, not here).

## Needs a decision: a small backend
GitHub Pages only serves files, so these all need a small server (Cloudflare Worker, Supabase edge function or Vercel):
- **Staying signed in.** The app uses Google's browser-only sign-in, which gives 1-hour access and no refresh token. It re-signs in silently when it comes back to the front, which reloads the page about once an hour. A backend holding a refresh token would remove that. Note: while the Google consent screen is in Testing, refresh tokens expire after 7 days.
- **Reminders** (Web Push) while the app is closed.
- **A Claude connector** (MCP) to read and add tasks from Claude.

## Test early on a real iPhone
- Sign-in and the silent hourly re-sign-in from the Home Screen app
- An update reaching the installed app (bump the version, deploy, reopen)

## Later
- Timed calendar events that cross midnight show only on their start day
- Writing to Google Calendar (the app reads it only). If added: send an explicit time zone with every timed event
- Two devices editing the same task: the last save wins
