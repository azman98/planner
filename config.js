// Google OAuth Web client ID. Public by design (it identifies the app, it is not a secret).
window.PLANNER_CONFIG = {
  clientId: "PASTE_CLIENT_ID.apps.googleusercontent.com",
  // Names of the Google Tasks lists used for each area. Created automatically if missing.
  lists: { work: "Work", school: "School", personal: "Personal" },
  defaultTargets: { work: 20, school: 15, personal: 10 }
};
