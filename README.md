# Planner

Personal planner for work, school and personal life. Installable web app (PWA, Progressive Web App) for iPhone and Mac.

- **Tasks** live in Google Tasks, in three lists: Work, School, Personal (created on first sign-in)
- **Calendar** events from Google Calendar show on the timeline; assign a calendar to an area in Settings to count its hours toward that area's weekly balance
- **Offline**: changes save on the device and sync when back online
- No server, no database: the app talks to Google directly from your browser

## Quick add syntax

| Type | Result |
|---|---|
| `#work` `#school` `#personal` | area |
| `today` `tomorrow` `fri` `3/11` `2026-11-03` | date (day/month) |
| `14:00` `2pm` | start time |
| `90m` `1.5h` | duration |
| `!1` `!3` | priority |

Example: `Problem set 4 #school fri 18:00 90m !1`

Start time, duration and priority are stored on the last line of the task's notes in Google Tasks as `#planner start=18:00 mins=90 prio=1`, so they survive editing in the Google Tasks app.

## Setup

1. Google Cloud project with **Google Tasks API** and **Google Calendar API** enabled
2. OAuth consent screen: External, your account added as a test user, scopes `auth/tasks` and `auth/calendar.readonly`
3. OAuth client (Web application)
   - Authorized JavaScript origin: `https://azman98.github.io`
   - Authorized redirect URI: `https://azman98.github.io/planner/`
4. Put the client ID in `config.js`
5. GitHub Pages: Settings → Pages → Deploy from branch `main`, folder `/ (root)`

## Install

- **iPhone:** open the site in Safari → Share → Add to Home Screen
- **Mac:** Safari → File → Add to Dock (or Chrome → Install page as app)

## Files

- `index.html`, `styles.css`, `app.js`: the app
- `config.js`: client ID and list names
- `sw.js`: service worker for offline use
- `manifest.webmanifest`, `icons/`: install metadata
