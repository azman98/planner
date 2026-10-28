// Checks to run before every deploy: node test.js
const fs = require("fs"), path = require("path"), assert = require("assert"), { execFileSync } = require("child_process");
const read = f => fs.readFileSync(path.join(__dirname, f), "utf8");
let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.message); } };

check("JavaScript files parse", () => { for (const f of ["app.js", "sw.js", "config.js", "changelog.js"]) execFileSync(process.execPath, ["--check", path.join(__dirname, f)]); });

const sw = read("sw.js");
const swVersion = +(sw.match(/VERSION = "planner-v(\d+)"/) || [])[1];
const shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]*\])/)[1]);
const win = {}; new Function("window", read("changelog.js"))(win);
const log = win.PLANNER_CHANGELOG;

check("sw.js VERSION matches the newest changelog entry", () => assert.strictEqual(swVersion, log[0].v, `sw.js says v${swVersion}, changelog.js says v${log[0].v}`));
check("changelog versions go down by one", () => log.forEach((c, i) => i && assert.strictEqual(c.v, log[i - 1].v - 1, `entry ${i}`)));
check("every file in SHELL exists", () => shell.filter(f => f !== "./").forEach(f => assert.ok(fs.existsSync(path.join(__dirname, f)), f + " is missing")));
check("every local file index.html loads is in SHELL", () => {
  const refs = [...read("index.html").matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]);
  refs.forEach(r => assert.ok(shell.includes(r), r + " is not in SHELL in sw.js"));
});
check("no absolute paths (the site lives under /planner/)", () => {
  for (const f of ["index.html", "manifest.webmanifest", "sw.js"]) assert.ok(!/(?:src|href|"src"|start_url)\s*[=:]\s*"\/(?!\/)/.test(read(f)), f);
});

global.window = {}; global.location = { origin: "https://example.github.io", pathname: "/planner/" }; // app.js reads these before its Node export
const { parseQuick, parseNotes, buildNotes } = require("./app.js");
const now = new Date(2026, 9, 28, 9, 0); // Wed 28 Oct 2026
check("quick add: full sentence", () => {
  const p = parseQuick("Problem set 4 #school fri 18:00 90m !1", "work", now);
  assert.deepStrictEqual({ ...p }, { area: "school", prio: 1, due: "2026-10-30", start: "18:00", mins: 90, title: "Problem set 4" });
});
check("quick add: time alone means today", () => assert.strictEqual(parseQuick("Call 2pm", "work", now).due, "2026-10-28"));
check("quick add: d/m date before today rolls to next year only when far back", () => {
  assert.strictEqual(parseQuick("x 3/11", "work", now).due, "2026-11-03");
  assert.strictEqual(parseQuick("x 1/2", "work", now).due, "2027-02-01");
});
check("quick add: tomorrow", () => assert.strictEqual(parseQuick("Gym tomorrow", "personal", now).due, "2026-10-29"));
check("notes metadata round trip", () => {
  const t = { notes: "Bring laptop", start: "09:30", mins: 45, prio: 1 };
  const back = parseNotes(buildNotes(t));
  assert.deepStrictEqual(back, { notes: "Bring laptop", start: "09:30", mins: 45, prio: 1 });
  assert.deepStrictEqual(parseNotes("plain"), { notes: "plain", start: null, mins: 0, prio: 2 });
});

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nAll checks passed");
