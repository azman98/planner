// "What's new": one entry per deploy, newest first.
// The first entry's v must equal the number in VERSION in sw.js (node test.js checks this).
window.PLANNER_CHANGELOG = [
  { v: 2, date: "2026-10-28", items: [
    "Updates install themselves: the app checks for a new version every 10 minutes and when you come back to it",
    "Settings → What's new lists every update",
    "On iPhone, a hint shows how to add the app to the Home Screen"
  ] },
  { v: 1, date: "2026-10-28", items: [
    "First version: Google Tasks + Calendar, Today / Week / Month / All, quick add, offline changes"
  ] }
];
