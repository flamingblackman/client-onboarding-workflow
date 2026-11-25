# Intensive QA Report — Client Onboarding Workflow

**Date:** 2026-11-24 (evening, America/New_York)
**Scope:** static review of local files only. No live Sheet, Form, or Apps Script was touched; no browser was used; nothing was fixed.
**Files reviewed:** `apps-script/Code.gs` (Steps 1–4), `spec.md`, `acceptance.json`, `app/app.js`, `app/index.html`, `app/styles.css`, `docs/runbook.md`, `README.md`, `defects.md`, `verify-cycle1.js`, `verify-cycle2.js`, `sample-payloads/intake.json`.
**Method:** four independent reviewers ran in parallel (Apps Script logic, Sheet/Dashboard formulas, portal demo, docs accuracy), each re-running business-day and date math independently in Node where applicable. Findings were consolidated here, deduplicated, and cross-checked against `defects.md` so nothing already filed is re-reported as new.

## Summary

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 17 |
| Minor | 14 |
| **Total** | **32** |

**Top 3 defects:**
1. **QA-B1 (blocker) — Step 3 is silently defeated by any hand-written note in column J.** The `onOnboarded` guard treats any content in Notes / Close-out as "already closed out," but the runbook says Bryan can add notes there by hand. Step 3 must not be installed as-is.
2. **QA-M01 (major) — Step 2's guard keys on Follow-up date (H), not Contacted on (I).** If H is hand-filled, Contacted on is never stamped, and Dashboard time-to-contact goes blank/meaningless. Step 2 is being installed right now; this should be fixed in the same edit.
3. **QA-M09 (major) — Timezone is pinned nowhere in the code.** Every "today," every date stamp, and the digest depend on the Apps Script project's timezone setting, which is not in the repo and not verified in the runbook. Same failure class as portal DEF-01 (passed in UTC, failed in ET). Single highest-leverage fix; affects all four steps.

**Install-order guidance (from the review):** Step 2 — weigh QA-M01, QA-m04, QA-m05, QA-M07, QA-M09, QA-M10 before install (M01 and m04 are cheapest to fix in the same edit). Step 3 — do NOT install as-is (QA-B1 blocker; decide QA-M07 with it). Step 4 — do NOT install as-is without QA-M08 (missed rows) and QA-m03 (weekday guard). QA-M09 (timezone) affects all four steps.

**Portal:** the 2-cycle fix cap is hit. Portal defects below are reported only, with no suggested fix, for Bryan's triage.

## Blocker

### QA-B1 — Step 3 is silently defeated by any hand-written note in column J
- **Severity:** Blocker
- **Location:** `apps-script/Code.gs`, `onOnboarded`, guard line 169: `if (sheet.getRange(row, 10).getValue()) return;`
- **What is wrong:** The guard treats *any* content in Notes / Close-out (J) as "already closed out." But the runbook (§Intake Log columns, §D) says J is also where "Bryan can add notes by hand." The guard cannot distinguish a machine close-out note from a manual note.
- **Reproduce:** Row is Contacted. Bryan types `called, left voicemail` in J. Later he changes Status to Onboarded. `onOnboarded` sees J non-empty and returns: no close-out note is written **and** Follow-up date (H) is not cleared. The row sits as Onboarded with a live follow-up date and no close-out record, and nothing alerts anyone.
- **Suggested fix:** Don't guard on J. Guard on whether J already starts with `Onboarded ` (the machine note prefix), or check J for the exact `Onboarded yyyy-mm-dd — …` pattern. Same class as QA-M01 — the guard must test the machine's own output, not the whole column.

## Major

### QA-M01 — Step 2 is silently defeated by a hand-entered Follow-up date
- **Severity:** Major
- **Location:** `apps-script/Code.gs`, `onStatusChange`, guard line 138: `if (sheet.getRange(row, 8).getValue()) return;`
- **What is wrong:** The guard treats a non-empty Follow-up date (H) as "already stamped." But H is hand-entered by Bryan whenever Step 2 isn't live (runbook §C.5), and a stray space in H is truthy too. The guard should test Contacted on (I), the field Step 2 itself stamps.
- **Reproduce:** Row is New. Bryan fills H with a planned follow-up date, then changes Status to Contacted. `onStatusChange` returns early; Contacted on (I) is never stamped. Dashboard time-to-contact for that row is blank/meaningless, while H looks done. Same failure if H was filled before Step 2 was installed and the status is re-set.
- **Suggested fix:** Guard on column I instead: `if (sheet.getRange(row, 9).getValue()) return;`. If H is already filled by hand, stamp I anyway (or stamp I and leave the hand-entered H alone).
- **Related:** QA-M12 (Dashboard time-to-contact has no guard for a blank Contacted on — the downstream consequence of this defect).

### QA-M02 — Blank/invalid client email aborts the welcome email; no isolation between the two sends
- **Severity:** Major
- **Location:** `apps-script/Code.gs`, `onIntakeSubmit`, welcome send line 56
- **What is wrong:** `email` is used exactly as typed — no trim, no format check, no empty check — and each `GmailApp.sendEmail` is unguarded, so one failure aborts the rest of the function. The blank case already happened live (runbook Live fixes, Nov 24: first run arrived with empty fields, welcome failed with "no recipient"). An invalid address (`notanemail`, `jordan@`, leading/trailing spaces) throws the same way. Worse, the alert is sent *first*: if the alert send fails (auth lapse, quota), the welcome is never attempted even though the row is fine; if the welcome fails, the execution errors with no retry and no record beyond the Executions log.
- **Reproduce:** Submit the form with Email blank (or `notanemail`). Row logs, alert arrives, `GmailApp.sendEmail('')` throws, client gets nothing.
- **Suggested fix:** Validate/trim before sending (`/^\S+@\S+\.\S+$/`, reject blank); wrap each send in its own try/catch so an alert failure can't kill the welcome and vice versa, and log/flag a failed welcome (e.g. write `WELCOME FAILED` in J) instead of dying silently.

### QA-M03 — No dedup, no lock: duplicate submits double-log, and concurrent submits can overwrite each other
- **Severity:** Major
- **Location:** `apps-script/Code.gs`, `onIntakeSubmit`, row pick line 29: `var row = sheet.getLastRow() + 1;`
- **What is wrong:** There is no idempotency check (same email + timestamp + need) and no `LockService`. Row placement is `getLastRow() + 1` computed at trigger time. Two consequences: (a) any re-run after a failure (e.g. the QA-M02 welcome failure, or a manual re-run) appends a second row and re-sends the alert; (b) two submits landing near-simultaneously can both compute the same `row`, and the second `setValues` overwrites the first — one intake is lost from the log while both clients got welcome emails.
- **Reproduce:** Submit twice in quick succession (double-click / retry after an error). Two rows, two alerts, two welcomes. For the race: two submits within the same execution window both read `getLastRow() = N` and both write row `N+1`.
- **Suggested fix:** Take a script lock (`LockService.getScriptLock()`, tryLock/waitLock) around row-pick + write, and/or use `appendRow` instead of `getLastRow()+1`; add a dedup scan (same Email + Timestamp already in the log → skip row + emails, or skip row but still alert).

### QA-M04 — A typo'd status makes the row invisible to every monitor
- **Severity:** Major
- **Location:** `apps-script/Code.gs`, `onStatusChange` line 137 and `onOnboarded` line 168; runbook "Failure Modes Considered"
- **What is wrong:** The script relies entirely on Sheet-side dropdown validation to prevent typos, and the runbook asserts it "rejects values outside New / Contacted / Onboarded." The script itself does no validation, and the handlers use exact, case-sensitive equality (`!== 'Contacted'`). A pasted value, an API write, a "Show warning" validation setting, or `contacted` / `Contacted ` (trailing space) bypasses or defeats it — and then *everything* misses the row at once: both handlers return silently, the K formula's `G="New"` is false so no OVERDUE flag, Dashboard COUNTIFs miss it, and the digest's `status !== 'New'` skips it.
- **Reproduce:** Paste `Contactd` (or `contacted`) into G. Nothing stamps, nothing flags, nothing digests; the row is New in substance but counted nowhere.
- **Suggested fix:** Normalise before comparing (`String(v).trim()` + case-insensitive match) in both handlers and in the digest; optionally correct the cell to the canonical value, or write a warning into J when G holds an unrecognised value.

### QA-M05 — Bulk / multi-cell edits stamp only the top row (or nothing)
- **Severity:** Major
- **Location:** `apps-script/Code.gs`, `onStatusChange` lines 134–137, `onOnboarded` lines 165–168
- **What is wrong:** Both handlers assume a single-cell edit in G: they read `e.range.getRow()` / `getColumn()` / `getValue()`, which are the *top-left* of the edited range only. A paste of Contacted down G2:G5 stamps row 2 and silently skips rows 3–5. A paste of a whole row range starting before G (e.g. A2:J2) has `getColumn() !== 7` and is ignored entirely.
- **Reproduce:** Select G2:G5, paste `Contacted`. Only row 2 gets Contacted on + Follow-up date; rows 3–5 stay blank with no error.
- **Suggested fix:** Iterate `e.range.getValues()` over all edited rows/columns; for each row where column G in the range equals Contacted/Onboarded, apply that row's action.

### QA-M06 — Onboarded → Contacted keeps the close-out note (Portal FIX-1 never ported)
- **Severity:** Major
- **Location:** `apps-script/Code.gs`, `onStatusChange` (no write to J)
- **What is wrong:** Step 3 clears H and writes the close-out note in J. If the row is later flipped back to Contacted, H is empty so the Step 2 guard passes and it re-stamps I and H — but J is never cleared. The row reads Contacted while displaying `Onboarded 2026-11-24 — welcome complete; no further follow-up.` This is exactly the incoherence Portal FIX-1 fixed in `app.js` (clear note, fresh follow-up on re-contact); the script still has it.
- **Reproduce:** Contacted → Onboarded (note appears, H cleared) → Contacted. I = today, H = +2 business days, J still shows the old close-out note.
- **Suggested fix:** In `onStatusChange`, clear J (column 10) when re-stamping a Contacted row.

### QA-M07 — Reverting to New leaves stale fields; re-Onboarding then keeps a stale close-out date
- **Severity:** Major
- **Location:** `apps-script/Code.gs`, `onStatusChange` / `onOnboarded` (no handling for Status → New at all)
- **What is wrong:** Nothing handles a revert. Contacted → Onboarded → New leaves I (old Contacted on) and J (old close-out note) in place on a New row. Worse, the chain continues: New → Contacted re-stamps I/H, then → Onboarded hits the QA-B1 guard (J non-empty) and returns, so the row keeps the *first* onboarding date as its close-out note — a wrong record. Portal FIX-2 addressed the revert in the demo (preserve note, clear contact fields); the script addresses none of it.
- **Reproduce:** Onboard a row Nov 24 → revert to New → Contacted → Onboarded. The close-out note still reads `Onboarded 2026-11-24`, dated from the first onboarding, not the second.
- **Suggested fix:** Decide and implement revert behaviour (Bryan's call, per the Portal triage): at minimum, on Status → New clear I and H and leave J as a preserved record, and make the Onboarded guard recognise a preserved note vs. a current close-out (see QA-B1).

### QA-M08 — Digest silently drops overdue rows whose Timestamp is text (or a number)
- **Severity:** Major
- **Location:** `apps-script/Code.gs`, `sendOverdueDigest`, line 192: `if (!ts || !(ts instanceof Date)) continue;`
- **What is wrong:** Any New row whose Timestamp cell is not a Date object — text from a paste/import, a serial number from a values-only paste — is skipped with no log, no alert, no fallback parse. Step 1 always writes a real Date, so this only bites manually-created rows, but runbook §E requires verifying *every* overdue row is included, and the digest is the safety net for exactly those rows.
- **Reproduce:** Paste a row with Timestamp as the text `2026-11-13 10:00` and Status New. Wait past the deadline: no digest line ever, even though the row is days overdue.
- **Suggested fix:** Fall back to parsing: `if (typeof ts === 'string') ts = new Date(ts)` (or `Date.parse`), and accept numeric serials via Sheets epoch conversion; skip only if the result is still an invalid date, and log skipped rows.
- **Related:** QA-M13 (Sheet overdue FILTER has the same text-Timestamp hazard).

### QA-M09 — Timezone is pinned nowhere in the code (same class as Portal DEF-01)
- **Severity:** Major
- **Location:** `apps-script/Code.gs`, all date handling — `new Date()` lines 139–140, 170–171, 185–186; `parseFormDate` line 122; `formatDate` lines 225–230; no `Session.getScriptTimeZone()` / `Utilities.formatDate(..., 'America/New_York', ...)` anywhere in the repo
- **What is wrong:** Every "today at midnight," every `getFullYear/getMonth/getDate`, and `parseFormDate`'s local-midnight construction depend on the Apps Script project's timezone setting, which is not in the repo and not verified in the runbook. If the project timezone is not America/New_York (new projects commonly default to GMT), then near midnight ET: Contacted on / Follow-up dates stamp a day off, the close-out note's `formatDate(today)` can show the wrong date, `parseFormDate`'s midnight is midnight in the wrong zone so the Sheet (ET) can display the start date a day early, and the digest's "today" is the wrong date on the boundary day. This is the same failure class as Portal DEF-01, which passed in UTC and failed in ET.
- **Reproduce:** Set the script project timezone to UTC, submit/contact a client at 23:30 ET (03:30 UTC next day): Contacted on stamps tomorrow's date.
- **Suggested fix:** Set the project timezone to America/New_York and assert it in code, or compute all dates explicitly in ET via `Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd')` / a pinned ET-midnight helper. (DST itself is fine — verified: `addBusinessDays(Fri 2026-03-06, 2)` = Tue 2026-03-10 across the spring-forward.)

### QA-M10 — No null guards: a renamed tab or a trigger run without an event object kills the intake silently
- **Severity:** Major
- **Location:** `apps-script/Code.gs`, `onIntakeSubmit` lines 16, 23, 25; `sendOverdueDigest` line 181
- **What is wrong:** `e.response` is dereferenced unconditionally (`r.getTimestamp()`), and `getSheetByName(LOG_TAB)` is used without checking for `null`. A manual/test run of `onIntakeSubmit` with no event, or a renamed Intake Log tab, throws a TypeError before any row or email — the intake is lost with only an Executions-log entry. The tab name is a single string constant with no fallback.
- **Reproduce:** Rename the tab to `Intake log` (lowercase l), submit the form. No row, no emails, only a failed execution.
- **Suggested fix:** Guard `if (!e || !e.response) return/log`, and `if (!sheet) { GmailApp.sendEmail(ALERT_TO, '…', 'Intake Log tab missing…'); return; }` (or look the tab up case-insensitively).

### QA-M11 — "Business days waiting" (NETWORKDAYS minus 1) undercounts by exactly 1 for any intake submitted Saturday or Sunday
- **Severity:** Major
- **Location:** `docs/runbook.md`, "Dashboard formulas (live)" — "business days waiting via NETWORKDAYS minus 1"; affects both the oldest-uncontacted figure and the waiting column in the overdue list
- **What is wrong:** `NETWORKDAYS(INT(A),TODAY())-1` counts weekdays from the timestamp date inclusive, minus 1. That equals spec §6.1's definition ("weekdays strictly after the timestamp date, up to and including today") only when the timestamp falls on a weekday. For a weekend timestamp it is exactly 1 short. Verified by computation: Sat → Mon: NETWORKDAYS−1 = 0, §6.1 = 1; Sun → Mon: 0 vs 1; Sat → Tue: 1 vs 2; Fri → Wed: 3 = 3 (matches — which is why the Nov 18 test evidence, Fri Nov 13 → Wed Nov 18, didn't catch it; both test rows had weekday timestamps).
- **Consequence beyond display:** if the overdue FILTER's selection test reuses this same waiting figure (`waiting > 1`), a Saturday intake is not listed overdue until Wednesday instead of Tuesday, and the Dashboard overdue list will disagree with the per-row K flag (K correctly flags it Tuesday). The runbook never states which test the FILTER uses, so this half is conditional — see Live-QA item 5.
- **Suggested fix:** replace the waiting figure with `=IF(TODAY()<=INT(A),0,NETWORKDAYS(INT(A)+1,TODAY()))`, which counts weekdays strictly after the timestamp date through today and returns 0 same-day or for future timestamps. Verify against §6.1's four examples (Mon→Tue 1, Mon→Wed 2, Fri→Mon 1, Fri→Tue 2) plus Sat→Mon 1, Sun→Mon 1.
- **Consolidation note:** this is the same root cause as the script-side `businessDaysWaiting` discrepancy (Apps Script review m1): the script counts Sat→Mon as 1 waiting day, the Dashboard counts 0. Spec §6.1 sides with the script (1). The defect is in the Dashboard formula; the script is correct per spec. Fix the Dashboard, not the script.

### QA-M12 — Time-to-contact description has no guard for a Contacted row with a blank Contacted on (and none for negative values)
- **Severity:** Major
- **Location:** `docs/runbook.md`, "Dashboard formulas (live)" — "average and median of INT(Contacted on) minus INT(Timestamp), whole days, for rows currently Contacted"; README §5 same wording
- **What is wrong:** as literally described, the population is "rows currently Contacted" with no `Contacted on <> ""` condition. `INT()` of a blank Contacted on is 0, so one such row contributes a whole-day value of roughly −46,000, which poisons both the average and the median. The mechanism is live right now: until Step 2 is installed Bryan stamps Contacted on by hand, and a missed stamp is exactly this row. Worse, it can persist after Step 2 lands: `onStatusChange` keys its loop guard on Follow-up date (H) being empty (see QA-M01), so a row where Bryan set H by hand but not I will never get I stamped. The description also has no guard for a future Timestamp or a backdated Contacted on, both of which produce negative whole-day values.
- **How to prove it:** this is a defect in the *documented* formula — the live cell text was not in the local files, so Live-QA item 4 must confirm whether the live formula already guards. If the live formula is literally `AVERAGE(FILTER(INT(I)-INT(A), G="Contacted"))` with no I-blank condition, the defect is live.
- **Suggested fix:** add `I<>""` (and ideally `I>=A`) to the FILTER conditions for both the average and the median, e.g. average over `FILTER(INT(I)-INT(A), G="Contacted", I<>"")`.
- **Related:** QA-M01 (the script-side cause: a Contacted row can exist with a blank Contacted on).

### QA-M13 — Overdue FILTER: blank/text Timestamp hazards, and its selection test is undocumented
- **Severity:** Major (conditional on FILTER construction)
- **Location:** `docs/runbook.md`, "Dashboard formulas (live)" — "Overdue list: FILTER of New rows whose timestamp is more than one business day old"; README §4/§5
- **What is wrong:** (a) If the FILTER's condition mirrors the K formula (`TODAY()>WORKDAY(INT(A),1)`), a blank-Timestamp New row is falsely listed as overdue (same QA-m06 arithmetic), and a single text-Timestamp New row makes the entire FILTER return `#VALUE!`, wiping the overdue list — `FILTER` propagates a per-row error in its condition to the whole result. (b) The runbook never states which overdue test the FILTER uses: the K-style `WORKDAY` test (correct for weekend timestamps) or the `NETWORKDAYS−1 > 1` test (one day late for weekend intakes per QA-M11). Two documented definitions of "more than one business day old" therefore exist and can disagree with each other and with K.
- **Suggested fix:** document and use one test everywhere — the K/Step 4 `WORKDAY` test — and add `ISNUMBER(A)` / `A<>""` to the FILTER conditions. Live-QA item 5 must read the actual FILTER text to confirm which test is live.
- **Related:** QA-M08 (script digest has the same text-Timestamp hazard).

### QA-M14 — Steps 2–4 called "designed / not built" — stale, wrong for all three
- **Severity:** Major
- **Location:** `README.md:8`, `README.md:29–30` (mermaid), `README.md:63`, `README.md:71`, `README.md:98–99` (status table); `docs/runbook.md:5`, `docs/runbook.md:104, 114, 123` (section headings), `docs/runbook.md:177–178` (troubleshooting), `docs/runbook.md:193` (Known limitations)
- **What is wrong:** all three steps exist as implemented functions in local `Code.gs`: `onStatusChange` (Step 2), `onOnboarded` (Step 3), `sendOverdueDigest` (Step 4), plus helpers `addBusinessDays`, `businessDaysWaiting`, `formatDate`. Step 2's trigger install is in progress right now; Steps 3–4 are written but their triggers are not installed live. "Not built" conflates "code written" with "trigger installed live."
- **How to prove it:** read `apps-script/Code.gs` — the three functions and their step comments are all present.
- **Suggested fix:** replace "designed, not built" everywhere with the two-part state, e.g. Step 2: "Written in local `Code.gs`; trigger install in progress, not yet verified"; Step 3 / Step 4: "Written in local `Code.gs`; trigger not installed live." Same for the troubleshooting fixes ("…until Step 2's trigger is installed and verified live") and runbook §F test steps 4–5 ("After Step 2 is installed live").

### QA-M15 — Runbook says Step 3 uses "the same onEdit trigger as Step 2" — contradicts the code
- **Severity:** Major
- **Location:** `docs/runbook.md:114–116` (§D, Step 3): "Design: the same onEdit trigger as Step 2." Same error in `README.md` §3: "Both steps are designs for a Sheet onEdit trigger watching the Status column" (singular trigger).
- **What is wrong:** the code has **two separate** installable onEdit handler functions — `onStatusChange` ("Step 2 — Contacted auto-stamp (installable onEdit trigger on the Sheet)") and `onOnboarded` ("Step 3 — Onboarded close-out (its own installable onEdit trigger on the Sheet)"). Each needs its own installed trigger. A deployer following the runbook would install one trigger and Step 3 would never fire.
- **How to prove it:** `Code.gs` defines `onStatusChange(e)` and `onOnboarded(e)` as distinct functions, each with its own tab/column/status guards.
- **Suggested fix (runbook §D):** "Design: its own installable onEdit trigger on the Sheet, function `onOnboarded` — separate from Step 2's `onStatusChange` trigger. Both watch Status (column G); each returns early unless the new value is its own status." Same fix in README §3 ("two separate onEdit triggers, one per step").

### QA-M16 — Deployment checklist never names the Step 2–4 trigger functions
- **Severity:** Major
- **Location:** `docs/runbook.md` §C, §D, §E (deployment checklist); also `README.md` §3–§4
- **What is wrong:** `onStatusChange`, `onOnboarded`, and `sendOverdueDigest` appear **zero times** in either doc. By contrast, Step 1's function (`onIntakeSubmit`) is named in both docs. The checklist gives design prose only — no function names, no trigger-install steps (trigger type, source, function, schedule) for Steps 2–4. A deployer cannot install Steps 2–4 from the runbook alone. Related: runbook §C.3 says "the business-day math is a small helper in the script" without naming `addBusinessDays`.
- **How to prove it:** `grep -rn "onStatusChange|onOnboarded|sendOverdueDigest" README.md docs/runbook.md` returns nothing; all three functions exist in `Code.gs`.
- **Suggested fix:** add to each checklist section the installable-trigger spec, mirroring §B's format — e.g. §C: "Trigger: installable onEdit on the Sheet — function `onStatusChange`, event source 'From spreadsheet', event type 'On edit', enabled"; §D: same with `onOnboarded`; §E: "Trigger: time-driven, weekdays 9:00 AM ET — function `sendOverdueDigest`." Name `addBusinessDays` in §C.3.

### QA-M17 — "Kept in sync with the live file verbatim" is currently false
- **Severity:** Major
- **Location:** `README.md` §2 ("Local source: `apps-script/Code.gs`, kept in sync with the live file verbatim") and `docs/runbook.md` (Accounts section and §B: "keep it in sync with the live file verbatim after every edit")
- **What is wrong:** local `Code.gs` contains Steps 2–4, which the live script does not yet have installed — live is verified only through Step 1, Step 2's install is in progress, Steps 3–4 are not installed. Local is currently **ahead** of live, not verbatim in sync.
- **How to prove it:** local `Code.gs` (230 lines) contains `onStatusChange`, `onOnboarded`, `sendOverdueDigest`; known live state has only Step 1 verified.
- **Suggested fix:** "Local source: `apps-script/Code.gs` — this is the source to install from. Live currently has Step 1 only (Step 2 install in progress); sync the local copy verbatim after every live edit and re-check after each step install."

## Minor

### QA-m01 — `parseFormDate` silently rolls invalid dates forward and passes non-ISO strings through as text
- **Severity:** Minor
- **Location:** `apps-script/Code.gs`, `parseFormDate`, lines 116–123
- **What is wrong:** No range validation: `new Date(2026, 12, 45)` (input `2026-13-45`) rolls over to 2027-02-14; `2026-02-30` becomes 2026-03-02 (verified in Node). A non-`yyyy-mm-dd` string (`11/24/2026`, or any 3-part split failure) is returned verbatim, so column F ends up mixed Date/text. The Form date picker constrains this in practice, so likelihood is low.
- **Suggested fix:** Validate month 1–12 and day against the month's length (and round-trip the constructed date); return `''` for anything invalid instead of the raw string.

### QA-m02 — `namedValuesMap` prefix tolerance covers only 2 of 5 titles
- **Severity:** Minor
- **Location:** `apps-script/Code.gs`, `namedValuesMap`, lines 66–95
- **What is wrong:** Only `Start date` and `What they need` get prefix matching (`indexOf(...) === 0`); Name, Company, Email require exact titles. If any of those three is ever retitled (e.g. `Email address`), `firstValue` returns `''` and the welcome send fails (QA-M02). Related smell: the fallback's prefix-mapping guard `!out['Start date']` tests array truthiness — an `['']` entry is truthy, so a blank literal-titled value would block mapping of a real full-title value (contrived in the current form, since one question yields one key, but the check should be `!out['Start date'][0]`).
- **Suggested fix:** Apply the same prefix (or `indexOf`) tolerance to all five titles, and test the first element, not the array, in the fallback guard.

### QA-m03 — Digest has no weekday guard; it relies entirely on trigger configuration
- **Severity:** Minor
- **Location:** `apps-script/Code.gs`, `sendOverdueDigest`, lines 177–180 (comment says "weekdays 9:00 AM ET")
- **What is wrong:** The code never checks the day of week. If the time trigger is ever installed as daily instead of Mon–Fri, Saturday/Sunday digests go out — and they wouldn't even be empty: a Thursday intake is overdue on Saturday under both the script math and the K formula (Thu +1 business day = Fri; Sat > Fri), so a weekend digest would fire. Minor because the trigger config is the intended control, but the code doesn't defend it.
- **Suggested fix:** Add `if (today.getDay() === 0 || today.getDay() === 6) return;` at the top of `sendOverdueDigest`.

### QA-m04 — Multi-step writes are not atomic (partial stamps possible)
- **Severity:** Minor
- **Location:** `apps-script/Code.gs`, lines 30–41 (A–J then K), 141–142 (I then H), 173–174 (J then H-clear)
- **What is wrong:** Each step writes in two separate `setValue(s)` calls. If execution is interrupted between them (timeout, error), the row is half-stamped — e.g. Contacted on set but Follow-up date blank, or close-out note written but Follow-up date not cleared. The next status flip can repair Step 2 (H empty → re-stamp, overwriting I with a new date), but Step 3's half-state has no self-repair because of the QA-B1 guard.
- **Suggested fix:** Use a single `setValues` across the affected columns per step where possible.

### QA-m05 — Blank Name / What they need produce blank-subject alert and "Hi ," welcome
- **Severity:** Minor
- **Location:** `apps-script/Code.gs`, `onIntakeSubmit`, lines 44–63
- **What is wrong:** Name and Email are required in the Form, but the script never validates them. If `namedValues` *and* the fallback both miss a field (the exact Nov 24 failure mode), the row logs blanks and both emails still go out with empty fields (`New client intake:  — `, `Hi ,`). The alert at least carries the (blank) body, so it's recoverable, but the client-facing email is broken.
- **Suggested fix:** If Name or Email is blank after both lookups, log the row with a flag and send the alert with a `MISSING FIELD` marker instead of sending a blank welcome (see QA-M02).

### QA-m06 — Per-row SLA formula flags a blank Timestamp as OVERDUE
- **Severity:** Minor
- **Location:** `apps-script/Code.gs`, `onIntakeSubmit` — `=IF(AND(G{row}="New",TODAY()>WORKDAY(INT(A{row}),1)),"OVERDUE","")`; also described in `docs/runbook.md` Step 1
- **What is wrong:** `INT()` of a blank cell is 0; `WORKDAY(0,1)` is serial 1 (Jan 1, 1900); `TODAY()>1` is always true. So any row with Status `New` and a blank Timestamp reads `OVERDUE`. Step 1 always writes a timestamp, so this needs a malformed row (hand-added row, cleared Timestamp cell) — but the flag is exactly the kind of false alarm that erodes trust in the SLA column, and the same flaw propagates to the overdue FILTER (QA-M13).
- **Suggested fix:** add a non-blank, numeric guard: `=IF(AND(ISNUMBER(A{row}),G{row}="New",TODAY()>WORKDAY(INT(A{row}),1)),"OVERDUE","")`. (`ISNUMBER` also covers QA-m07.)

### QA-m07 — Per-row SLA formula shows #VALUE! on a text Timestamp
- **Severity:** Minor
- **Location:** same K formula as QA-m06
- **What is wrong:** `INT("2026-11-13")` on a text value errors, and the error propagates through `AND`/`IF`, so the whole K cell reads `#VALUE!` instead of blank. The runbook Troubleshooting already acknowledges the failure mode ("check the Timestamp cell is a datetime value, not text") but the formula doesn't guard it.
- **Suggested fix:** the `ISNUMBER(A{row})` guard from QA-m06 also fixes this (cell reads blank on a text timestamp instead of erroring).

### QA-m08 — Oldest-uncontacted MINIFS/INDEX-MATCH has no documented guard for New rows with no numeric Timestamp, and none for future timestamps
- **Severity:** Minor
- **Location:** `docs/runbook.md`, "Dashboard formulas (live)" — "Oldest uncontacted intake: MINIFS on Timestamp where Status is New, name via INDEX/MATCH"
- **What is wrong:** (a) If New rows exist but none has a numeric Timestamp, `MINIFS` returns 0 and `MATCH(0, …)` returns `#N/A`, so the oldest-uncontacted cell errors instead of showing the empty state. The documented empty-state guard evidently keys on "no New intakes" (test evidence shows it works when the log is empty), which does not cover this case. (b) If the oldest New row's Timestamp is in the future, `NETWORKDAYS(INT(A),TODAY())−1` goes negative, displaying negative business days waiting.
- **Suggested fix:** guard the lookup on `MINIFS > 0` (fall back to the "None — no New intakes" state), and clamp waiting at 0 for future timestamps (the QA-M11 replacement formula already does this via its `TODAY()<=INT(A)` branch).

### QA-m09 — The zero-row guards that demonstrably exist live are not documented anywhere
- **Severity:** Minor (doc gap)
- **Location:** `docs/runbook.md`, "Dashboard formulas (live)" (and README §5)
- **What is wrong:** Test evidence proves the live Dashboard shows all three empty-state strings with zero rows — so the live average/median must be guarded against `#DIV/0!`, the MINIFS/INDEX-MATCH against `#N/A`, and the FILTER against FILTER's "no matches" `#N/A`. None of those guards (IF/IFERROR wrappers, or whatever form they take) is described in the runbook or README. Anyone rebuilding the Dashboard from these docs alone would ship the unguarded versions and get errors on an empty log.
- **Suggested fix:** record the exact guarded formula text for each Dashboard cell in the runbook (which also resolves the scope limitation for future reviewers).

### QA-m10 — Portal seed dates anchored to the most recent weekday, so displayed seed dates are wrong on Saturday/Sunday
- **Severity:** Minor (portal — reported only, no fix proposed; 2-cycle cap is hit, goes to Bryan's triage)
- **Location:** `app/app.js` — `buildSeed` / `effectiveToday` (seed-4 follow-up, seed-6 contacted_on/note, all start dates)
- **What is wrong:** `buildSeed` anchors every seed date to `effectiveToday(now)` (most recent weekday) instead of the calendar day. The dashboard *figures* are identical on weekends (business-day math only counts weekdays), but three displayed dates literally contradict spec §7 on a Saturday or Sunday: Sam Whitfield's Follow-up date reads **2026-11-20 (Friday)** when the app is opened Sat 2026-11-21 or Sun 2026-11-22; spec §7 says it is "today". Tom Alvarez's close-out note reads **"Onboarded 2026-11-16 …"** on Sat/Sun; 4 business days before Sat 2026-11-21 is 2026-11-17, and before Sun 2026-11-22 is also 2026-11-17. His Contacted on reads 2026-11-13; 5 business days before Sat/Sun is 2026-11-16. Start dates shift the same way (Maya Chen reads 2026-12-04 on Sat/Sun; calendar Sat+14 = 2026-12-05, Sun+14 = 2026-12-06).
- **Reproduce:** open the demo on Saturday 2026-11-21 (or Sunday 2026-11-22) and read Sam Whitfield's Follow-up date column (2026-11-20, not 2026-11-21), Tom Alvarez's Notes column (Onboarded 2026-11-16), and Maya Chen's Start date (2026-12-04, not 2026-12-05). On Monday–Friday all three read correctly.
- **Caveat for triage:** no frozen check verifies any of these displayed dates, and the prior evaluator blessed the `effectiveToday` anchoring because it keeps the binding dashboard figures identical every day. This is a literal-spec deviation in displayed dates only. The start-date instance of this was already recorded in `defects.md` as a cosmetic observation; the Sam follow-up and Tom note/contacted instances are new.

### QA-m11 — README Privacy Note says all test rows were deleted — one was kept
- **Severity:** Minor
- **Location:** `README.md` (Privacy Note): "Test rows used Bryan's own business email and were deleted after verification."
- **What is wrong:** the runbook's Live Fixes section says the Form/Sheet count mismatch was resolved by "keeping the one row Bryan asked to keep (Darius Hemmorage)", and the record confirms Darius is a test row kept on Bryan's call. Not all test rows were deleted.
- **How to prove it:** `docs/runbook.md` (Live fixes, "Form/Sheet count mismatch" bullet) vs `README.md` Privacy Note.
- **Suggested fix:** "Test rows used Bryan's own business email and were deleted after verification, except the Darius row Bryan asked to keep."

### QA-m12 — Sample payload's own note names the retired "Zap 1"
- **Severity:** Minor
- **Location:** `sample-payloads/intake.json`, `note` field: "Anonymized example of one intake as Zap 1 writes it to the Intake Log."
- **What is wrong:** Zap 1 was replaced by Apps Script Step 1 on Nov 24, 2026. The README (§"Sample Payload") describes the same file as "one intake as Step 1 writes it to the log" — the README and the file's own note contradict each other. Secondary nit in the same file: README says "The sample matches the log schema exactly," but the JSON carries an extra `note` key that is not one of the 11 log columns (Timestamp … SLA flag). The extra key is metadata, not a schema field.
- **How to prove it:** read `sample-payloads/intake.json` (file exists; all 11 log fields present plus `note`); README "Plot twist" paragraph confirms the Zapier→Apps Script move on Nov 24.
- **Suggested fix:** change the note to "Anonymized example of one intake as Step 1 writes it to the Intake Log." and soften the README line to "The sample matches the log schema exactly (plus a `note` metadata field)."

### QA-m13 — Loop-guard mechanism misdescribed for Steps 2 and 3
- **Severity:** Minor
- **Location:** `README.md` §3 Step 2 ("The empty-field condition is the loop guard") and `docs/runbook.md:§C.4` ("the edit re-fires the trigger, but Follow-up date is no longer empty, so the condition stops it"); same pattern in `runbook.md:§D.3` for the Notes / Close-out condition
- **What is wrong:** in the code, `onStatusChange`/`onOnboarded` check `e.range.getColumn() !== 7` first. The script's own writes land in columns H/I (Step 2) and J/H (Step 3), never column G, so the column check stops any re-fire before the empty-field check is reached. The empty-field condition is the **idempotency** guard (prevents re-stamping if Status is touched again), not the loop guard. The outcome (no loop) is correct; the attributed mechanism is wrong.
- **How to prove it:** `Code.gs`, `onStatusChange`/`onOnboarded` — column-7 early return precedes the empty-field checks; `setValue` calls target columns 8/9 (Step 2) and 10/8 (Step 3).
- **Suggested fix:** "Loop guard: the handler returns unless the edited cell is in the Status column (G), so its own writes to H/I/J never re-trigger it. The empty-field condition is the idempotency guard: re-touching Status does not re-stamp."
- **Related:** QA-B1 and QA-M01 — the mislabelling is what produced those two guard defects (the guards test the wrong thing).

### QA-m14 — README never mentions the portal demo
- **Severity:** Minor (coverage gap, not a false claim)
- **Location:** `README.md` as a whole (status table, architecture diagram)
- **What is wrong:** the repo contains the fictional-data portal demo (`app/`, plus `spec.md`, `acceptance.json`, `defects.md`), but the README covers only Form → Script → Sheet and never points to `app/` or states the demo is fictional-data-only and not connected to the Sheet. A reader has no way to find the portal from the README.
- **Suggested fix:** add a short section/row, e.g. "Demo portal: `app/` — fictional-data-only demo of the same pipeline (see `spec.md`); not connected to the live Sheet or Form."

## Live-QA checklist (browser check must verify — not provable from local files)

These are not defects. They are the items a live-browser run must check because the exact live formula/trigger text is not in any local file.

### Sheet / Dashboard (14 items)
1. **Exact formula text of every Dashboard cell** (counts, oldest MINIFS + INDEX/MATCH, waiting, average, median, overdue FILTER) — record verbatim in the runbook.
2. **Ranges:** whole-column (`G:G`) or fixed? Add a row beyond any fixed range and confirm counts/figures move. Confirm the overdue FILTER output area doesn't collide with content below it.
3. **Zero rows:** log with headers only → confirm New/Contacted/Onboarded/Total all 0 with no `#DIV/0!`, `#N/A`, or `#VALUE!` anywhere.
4. **Time-to-contact guards:** Contacted row with blank Contacted on; Contacted on as a datetime; future Timestamp; backdated Contacted on — confirm the metric stays sane (no −46,000 average, no negatives). Confirm the population is `G="Contacted"`, not `I<>""` (see item 13).
5. **Overdue FILTER construction:** which test — `WORKDAY` or `NETWORKDAYS−1 > 1`? Submit a Saturday intake, check Mon (waiting must read 1, not overdue) and Tue (waiting 2, overdue, matching K).
6. **K formula on live rows:** blank Timestamp + New → must read blank, not OVERDUE; text Timestamp → must not `#VALUE!`; confirm a per-row formula exists on every data row, including rows appended after the Step 2 install.
7. **Oldest uncontacted edge cases:** two New rows sharing the earliest timestamp; only New row has blank/text Timestamp; future-dated New row — confirm no `#N/A` and no negative waiting.
8. **Overdue list number format:** which Dashboard column holds the received date, and does the `yyyy-mm-dd hh:mm` format cover it? (Runbook Troubleshooting prescribes `A21:A100` — confirm the date is actually in column A of the output, or that range formats the wrong column.)
9. **Sheet timezone setting** is America/New_York (TODAY()/WORKDAY day boundaries must match Bryan's day).
10. **Total count construction:** SUM of the three COUNTIFs vs COUNTA-minus-header — and what a row with a blank or invalid Status does to it.
11. **Status dropdown validation** present on G for newly appended rows (a mistyped status silently drops a row from every count).
12. **Blank/gap rows in the middle** (e.g. a cleared test row whose K formula survives): confirm Dashboard figures are unaffected and the next append doesn't skip a row (a leftover K formula counts toward `getLastRow()`).
13. **Time-to-contact population:** confirm an Onboarded row carrying a Contacted on is excluded.
14. **Step 2 interaction:** after install, confirm no Contacted row can exist with a blank Contacted on (Step 2's guard keys on H, not I — a hand-set H with blank I would never be stamped).

### Portal demo (7 browser checks, still unverified)
APP-01 (loads, no sign-in wall), APP-02 (form matches Google Form), FORM-01 (blank submit blocked), FORM-02 (bad email blocked), FORM-03 (valid submit lands New row), DATA-02 (Reset restores seed), STATUS-02 reload step — plus confirming DASH-03 reads 1.0 / 1.0 on load in America/New_York, and the four fixed transitions live (Tom Onboarded → Contacted clears the note; Tom Onboarded → New keeps the note; Priya New → Onboarded leaves Contacted on blank; Friday re-contact follow-up lands Tuesday).

### Apps Script live checks
- Step 2 trigger actually installed and enabled (onStatusChange, From spreadsheet, On edit); Step 3 trigger installed separately (onOnboarded); Step 4 time trigger installed as Mon–Fri 9:00 AM ET (not daily).
- Script project timezone is America/New_York (see QA-M09).
- After Step 2 install, flip a Contacted row and confirm Contacted on + Follow-up date stamp; flip an Onboarded row and confirm the close-out note + cleared follow-up.

## Verified correct (checked, no defect)

**Apps Script:** `addBusinessDays` correct (Fri +2 = Tue, Thu +2 = Mon, Sat/Sun +2 = Tue, Mon +2 = Wed, DST spring-forward clean). Digest overdue threshold agrees with the K formula on every tested case; digest sends only when overdue rows exist (early return) and future timestamps are correctly excluded; digest column indices correct (A Timestamp, B Name, E What they need, G Status). `onStatusChange` and `onOnboarded` cannot both act on one edit (each returns unless Status equals its own value). No infinite loop — writes target columns 8/9/10 while both handlers only act on column 7, and programmatic `setValue` does not fire onEdit in Apps Script. Step 2 follow-up is +2 business days; Step 3 clears H and keeps I. New → Onboarded directly leaves Contacted on blank, matching Portal FIX-3. Close-out note text is exact. `namedValuesMap` fallback covers all five current titles; `responseValueString` correctly normalises Date answers. `formatDate`, `firstValue`, `responseValueString` correct. onEdit tab/row/column guards correct for single-cell edits. SLA formula in K is correct as written.

**Sheet/Dashboard:** K formula for weekday timestamps matches spec §6.1 exactly (Mon intake overdue Wed, Fri intake overdue Tue; future timestamps read blank; `INT()` strips the time component). Time-to-contact INT-on-both-sides fix is correct (same-day contact = 0). COUNTIF counts are sound as described (blank rows don't affect counts; zero rows give 0, no error). Step 4 digest logic matches §6.1 and K for all cases including weekend timestamps. Zero-row empty states work live (runbook Test evidence, Nov 18).

**Portal:** all 18 frozen checks pass at the logic level (verified independently in Node, 336 assertions, 0 failed, 7 days × 2 times, both timezones). All four cycle-2 fixes verified present and correct; DEF-01 still fixed. `parseLocalDate` intact at one call site. No network calls. Fictional data only. Honest framing intact.

**Docs:** Step 1 trigger/function, row write, SLA formula, alert/welcome subject/body, namedValues fallback — all match `Code.gs` exactly. Accounts/ownership/IDs correct in both docs. Form spec (5 questions, catalog order, helper text, one-business-day promise) consistent across README, runbook, spec §4.1, and code. Steps 2–4 behavior details (conditions, actions, close-out note text, digest subject/body, weekday 9 AM ET, send-only-if-overdue) all match the code. Dates and history (Zapier Nov 18 → Apps Script Nov 24; Step 1 verified Nov 24; Live Fixes) all accurate. Honest framing correct in both docs.

## Consolidation notes

- **Deduplication:** the script-side `businessDaysWaiting` weekend discrepancy (Apps Script review m1) and the Dashboard NETWORKDAYS−1 undercount (QA-M11) are the same root cause (two definitions of "business days waiting" that disagree on weekend timestamps). They are merged into QA-M11; spec §6.1 sides with the script's count, so the Dashboard formula is the one to fix.
- **Correction — spec §6.3 wording is RESOLVED, not a defect.** The Sheet reviewer claimed spec.md line 104 still reads "for rows with a Contacted on date." The coordinator's own read and the portal reviewer both confirm line 104 already reads "for rows currently Contacted" (aligned Nov 24 with Bryan's approval). Do not file this. The related live-QA item (confirm the live time-to-contact formula filters on `G="Contacted"`, not `I<>""`) remains as checklist item 13.
- **Not re-reported:** DEF-01, FIX-1 through FIX-4, and the §4.3.3 wording fix are all verified present/fixed and are not in this list. The portal observations already in `defects.md` (Sam's weekend contacted_on on Wed/Thu, re-applying Onboarded rewriting the note, cross-midnight reload reseeding, dead `error-company`/`error-start-date` markup) are not re-reported; only the new weekend-anchor displayed-date instances in QA-m10 are new.
- **What the existing test scripts do NOT cover:** `verify-cycle1.js` (253 assertions) and `verify-cycle2.js` (611 assertions) cover only the portal demo's logic (seed figures, transitions, idempotency, reset, both timezones). They do not cover the Apps Script (no test harness for `Code.gs` exists), the live Sheet formulas, the email sends, the trigger installs, or the docs. There is no automated test for Steps 1–4 at all — the live runs on Nov 24 are the only verification, and they covered Step 1 only.
- **Scope limitation:** no exact Dashboard formula text exists in any local file (runbook/README describe them in prose only). Several Sheet findings above (QA-M12, QA-M13, QA-m08) are defects in the *documented* formula; whether the live cell already guards is a Live-QA item, not provable here.

## Addendum — Claude second-opinion review (2026-11-24, 7:49 PM)

Chat: https://claude.ai/chat/15e50dfd-d800-4a9c-bdf7-0f3a05d276ec (Sonnet 5.5, Apple-signed-in account; the Google-signed-in account needed identity verification, which Bryan completed). Both files uploaded; review only, nothing edited live.

Verdict: fixes mostly sound, but one introduces a regression. Install Step 4 first, hold Step 3 for a small patch, don't paste the whole file over live Step 2 yet.

- True defect count nearer 26–27 than 32. Overstated: M04, M05, M08, M10 (real hardening, not Majors); M06, M07 (design decisions, Bryan's call); M12, M13 (speculation about live formulas the reviewers never saw); M14–M17 (documentation, not code defects). Duplicates: m05 ⊂ M02; m06 = m07; M14 = M17; M15 = M16.
- Solid: B1, M01, M02, M03, m03, m13. M11 arithmetic re-done and confirmed.
- New bugs in the fixes:
  - Bug 1 (most important, re-contact regression): Onboarded → Contacted, the I guard returns, so H is never re-stamped and the stale-note cleanup never runs. Row reads Contacted with no follow-up and "no further follow-up" in J. Worse than before the fix.
  - Bug 2 (Step 3 early return): onOnboarded returns before clearing H when a machine note already exists.
  - Bug 3 (blank welcome): blank name + valid email still sends "Hi ," and J gets no flag. Blank need produces "about ,". The header's "no blank welcome" claim was false.
  - Bug 4 (swallowed errors): try/catch around sends means failures no longer fail the execution, so Apps Script failure-notification emails never fire. Only Logger.
  - M09 only partly fixed: todayET still builds the Date from the project timezone; checkTimezone_ only logs. Real fix is "timeZone": "America/New_York" in appsscript.json + confirming the Sheet timezone.
  - M04 partial: canonical value never written back to G, so K and COUNTIFs miss a variant. M03: no SpreadsheetApp.flush() before releaseLock(); dedup (same email within 60s) drops a legitimate second submission; no catch around the write. M07: revert wipe is destructive on re-select/paste. M08 edge cases (date-only strings parse as UTC). Trigger hosting: verify Sheet triggers work from a Form-bound project.
- Patch applied to the local Code.gs (Nov 24 evening) and verified by verify-apps-script.js (31/31 pass): Bug 1 (strip machine note + clear I before the guard), Bug 2 (always clear H on Onboarded), Bug 3 (welcome requires a non-blank name; blank need reads "your inquiry"), M03 (flush, exact-timestamp dedup, write-error alert), M04 (canonical status written back to G), M07 (re-select guard via e.oldValue), M09 (checkTimezone_ emails an alert). Bug 4 (rethrow/send fallback alert on send failure) was NOT separately patched — the welcome failure already flags J, and the alert failure logs; noted as a follow-up.

## Addendum — ChatGPT second-opinion review (2026-11-24, 8:02 PM)

Chat: https://chatgpt.com/c/6b0632a9-f20c-83e9-88ec-cbce1461683e ("Review deployment safety"). Static review of the QA report + the 561-line Code.gs (with the Claude patch). Review only, nothing edited live.

Verdict: Conditional NO-GO overall. Do not replace the entire live file now, hold Step 3 pending transition tests, deploy Step 4 only after fixing the date-parsing bug. One targeted stabilization cycle, not another feature cycle. Deploy incrementally: Step 4 (after M08 fix), corrected Step 2, then Step 3.

- QA findings: broadly hold up (B1, M01, M02, M03, M09 valid; M04/M05/M08 severity conditional; M10 partially overstated; M12/M13 unconfirmed live defects; M14/M16 documentation; M17 insufficient evidence). Wrong/overstated: M17 (uninstalled triggers do not prove local/live differ), m07 (AND is not a reliable short-circuit guard for INT errors), m13 (programmatic writes do not fire edit triggers; the column check filters human edits), M12 (one bad value distorts the average, not necessarily the median). Consolidates to ~27–29 actionable items.
- Fixes: B1 pass (with caveat — the machine-note regex matches any hand note starting "Onboarded yyyy-mm-dd —", not just the machine message); M01 pass (with caveat — a truthy I is treated as proof the workflow completed; H and I should be validated independently); M09 partial (todayET() is not independently timezone-safe; the alert does not block processing when the timezone is wrong); M08 FAIL (date-only strings and serials parse as UTC, so a Monday intake reads as Sunday — the most significant remaining Step 4 issue); m03 pass; m06/m07 partial failure (AND does not reliably isolate INT errors; use a nested IF); M06/M07 partial (re-contact relies on note text; the patch reintroduces partial writes; bulk New edits are destructive; the "Previous onboarding" note keeps contradictory "no further follow-up" language); M04 partial (unrecognized status still silently skipped); M05 pass with caveat (no check that a bulk-pasted row is a real intake — phantom clients); M03 partial (dedup key is not durable — use the Form response ID; dedup suppresses welcome recovery; flush failures are ignored; lock timeout has no retry); M02 partial (Bug 4 unresolved — swallowed errors; name not trimmed so a whitespace-only name is truthy; failure flags overwrite Notes instead of appending; no business reply-to).
- New findings (missed by QA and Claude):
  - NEW-01 (high): spreadsheet formula injection — client Name/Company/Email/What they need are written with setValues(); a value starting with "=" is interpreted as a formula. User data must be stored as literal text.
  - NEW-02 (high): failure flags can land on the wrong row — the row number is remembered, the lock is released, emails are sent, then the flag is written back; a sort/insert/delete in between moves it.
  - NEW-03 (major): the two status handlers are not coordinated (no lock); rapid status changes can leave H/I/J inconsistent with the final status. Prefers one dispatcher with locking.
  - NEW-04 (major): no client-record existence check before stamping blank rows in bulk edits.
  - NEW-05 (major): handlers verify the tab name but not the spreadsheet ID.
  - NEW-06 (major): digest missing-tab/malformed-record failures are logged but not surfaced.
  - NEW-07 to NEW-13 (moderate/minor): broad prefix matching; writes can overwrite hand notes/formulas; timezone check runs before the Status check (excessive warning emails); close-out claims "welcome complete" even when Step 1 recorded WELCOME FAILED; spreadsheet-open/dedup-scan errors outside the write-error handler; no digest run identifier/daily-send guard; stale same-minute dedup comments.
- Deployment: Step 4 conditional GO after correcting M08 + confirming timezones + one digest trigger + verifying against K/Dashboard. Step 3 hold pending transition tests + tightening the machine-note matcher + deciding the contradictory email-delivery notes. Step 2 NO-GO for full-file replacement (replaces the working Step 1; too large a regression surface). Trigger hosting must be verified (Form-bound project, spreadsheet edit triggers via the API).
- Release acceptance checklist (0/27): 4 deployment config, 8 Step 1 regression, 8 Steps 2–3 transitions, 7 Step 4 SLA/digest. The 31/31 automated tests cannot substitute for these integration checks.
- Scores: business workflow design 8/10, QA methodology 8/10, normal-path functionality 8/10, edge-case handling 6/10, data integrity 5/10, failure recovery 4/10, deployment readiness 5/10.
- Note: the install browser task (a11baee7) was already past the file paste when this review arrived, so it was allowed to finish (stopping mid-paste risked a half-pasted live file). The ChatGPT items are a follow-up stabilization patch, not a reason to abort the in-flight install.

## Addendum — Claude review of reviews (2026-11-24, 8:20 PM)

Chat: https://claude.ai/chat/15e50dfd-d800-4a9c-bdf7-0f3a05d276ec (Sonnet 5.5). Same chat as the first Claude review. Three files uploaded: this QA report (with Claude + ChatGPT addenda), gemini-review-response.txt, and the 561-line Code.gs. Review only, nothing edited live. Claude also ran a throwaway check of the date-parsing and guard claims.

ChatGPT's findings — verdicts:
- NEW-01 formula injection: HOLDS, and Claude missed it. setValues treats a string starting with "=" as a formula. Name, Company, Email, Need all go in raw. Worst case is an =IMPORTXML-style formula leaking other rows. "High" is fair. It predates the QA patch.
- NEW-02 wrong-row flag: true but overstated. The row number is held across releaseLock() and two email sends (a few seconds); a sort/insert in that window is unlikely. Medium-low. Re-find by timestamp+email before writing fixes it. The write is also outside any try/catch.
- NEW-03 uncoordinated handlers: holds, but "one dispatcher" is more than needed. A quick Contacted→Onboarded flip can let a delayed Step 2 write H/I after Step 3 cleared H. A shared script lock plus re-reading G before writing covers it.
- M08 UTC parsing: holds, and Claude confirmed it. new Date("2026-11-23") formats as Sunday 11-22 in ET; a date-only serial does too. Effect is a one-day-early overdue flag and +1 waiting count. It only touches hand-made rows (Step 1 always writes a real Date). Correct but not "most significant".
- B1 matcher too broad: technically true, practically tiny. A hand note like "Onboarded 2026-11-20 — called" matches (confirmed). Bryan would have to type that exact pattern with the em dash. Matching the full machine sentence is a cheap fix.
- M01 H/I independent: fair. A Contacted row with I filled and H blank never gets a follow-up (happens if someone deletes the machine note or hand-stamps I). Cheap, not urgent.
- M02 Bug 4 swallowed errors: holds, and it is the one the addendum admits was not patched. Exceptions are caught so failure-notification emails never fire. Only Logger shows it. Rethrowing at the end if any send failed is a small fix.
- m06/m07 AND vs nested IF: holds, and Claude let it pass. Sheets' AND evaluates every argument, so an INT() error on a non-date text Timestamp still returns #VALUE!. Use IF(ISNUMBER(A),IF(AND(...),"OVERDUE",""),""). Real impact is hand-made rows only.
- NEW-04 (bulk stamping blank rows): worth a cheap guard. Dragging the dropdown past the data stamps dates into empty rows and pushes getLastRow() down.
- NEW-05 (spreadsheet ID check): overstated. NEW-09 (timezone alert on every edit): matters only if the timezone is wrong; then the alert would email on every edit and could burn the daily Gmail quota the welcome emails need.
- New from Claude: the dedup (lines 231–232) compares timestamps with === after a round trip through Sheets. It may miss a true duplicate by a millisecond. A 1-second tolerance would be safer. (This refines the earlier exact-timestamp change.)

Gemini's recommendation — does NOT hold up. Its premise is backwards:
- A single-cell Contacted→New edit is NOT skipped (oldValue is "Contacted", so the wipe runs). The guard skips only a no-op re-select of New on a cell that was already New.
- Bulk pastes always wipe (oldValue is undefined). So bulk is the more destructive path, the opposite of what Gemini says.
- Removing the guard would make the no-op re-select wipe a hand-entered follow-up date. If consistency is wanted, make bulk edits not wipe, or wipe only on a confirmed transition.
- Gemini's other points are weak: line numbers are off, its dedup comment describes the old 60-second version, its flush() claim is wrong (flush runs once per intake, not per row). The timezone and test-first advice is fine.
- DECISION: do NOT remove the isSingleCell guard. The deferred guard-removal item is cancelled.

Fix priority (Claude):
- Release-critical (before calling the install done): confirm project + Sheet timezones are America/New_York (settings, not code); confirm exactly one trigger per function and that Sheet triggers work from this Form-bound project; Step 1 regression (normal, blank email, invalid email, blank name, duplicate re-run); transition tests on a scratch row for Steps 2–3; fix NEW-01 before real clients use the form (also scan the existing log for cells in B:E starting with "="); fix M08 before enabling the Step 4 trigger.
- Patch soon (small and cheap): Bug 4 rethrow; digest missing-tab alert (NEW-06); NEW-03 lock + re-read of G; NEW-04 skip-blank-rows guard; m07 nested IF; throttle on the timezone alert; 1-second dedup tolerance.
- Nice-to-have: NEW-02 re-find, B1 matcher, M01 independent validation, NEW-05, NEW-07, NEW-08 to NEW-13.

In-flight install: let it finish, don't treat it as done. Stopping mid-paste risks a half-saved live file. The Step 1 path is already live to clients, so the Step 1 regression is the most urgent check now. Keep the previous Step-1-only file ready as rollback. Hold the Step 3 trigger until the transition tests pass. Hold the Step 4 trigger until the M08 fix and the timezone check are done. Fold all patch items into one more paste, and re-run the Step 1 regression after it. Each whole-file paste carries regression risk.

## Install report — first install complete (2026-11-24, 8:24 PM)

Browser task a11baee7 (desktop Chrome, 7:56–8:24 PM). The 561-line fixed file was pasted (4 chunks, line counts verified), saved clean, no syntax errors, all 12 functions present. Project timezone America/New_York and Sheet timezone America/New_York both confirmed. All 4 triggers installed and enabled (onIntakeSubmit, onStatusChange, onOnboarded new, sendOverdueDigest new, daily 9 AM). Step 1 retest passed (normal, invalid email with J4 "MISSING FIELD (Email) — welcome not sent."). Status-transition tests all passed (Test 1, 2, 3). The G2:G5 bulk-paste test was NOT run (would have required pasting over Darius). Dashboard correct; after cleanup New=0, Contacted=1, Onboarded=0, Total=1. Cleanup done: 4 test Sheet rows deleted, 7 Form responses deleted (Demo Test, Mentor Test, tryndamere, + 4 from the session). Form and Sheet agree at 1 (Darius, row 2, G2=Contacted, H2 blank, I2=2026-11-27). Two observations: (1) Timestamp offset — trigger-written Timestamps display as the UTC wall-clock (an 8:09 PM ET submit reads as 2026-11-25 01:09), while the API-written Darius row reads 17:21 correctly. This treats evening intakes as the next day for the SLA/digest. Fixed in the stabilization patch by toETDate_ (rebuild from ET calendar fields). (2) Duplicate within a minute did NOT dedupe — two distinct submits both logged. That is the code working as designed (exact-timestamp keying so a typo correction is not dropped); the Claude retest expectation was wrong, not the code. The runbook expectation needs reconciling. Also noted: the Form's Darius response reads "Darius Hemmorage" / "Demarcus Ionia Ink" while the Sheet row reads "Darius Hemmore" / "Demarcus Ionia" — pre-existing mismatch, not changed.

## Stabilization patch — applied locally, verified 51/51 (2026-11-24, ~8:30 PM)

Code.gs is now 729 lines. Patch items (from ChatGPT + Claude review of reviews): NEW-01 formula-injection sanitize, M08 ET date parsing (parseSheetDate_), Bug 4 rethrow + append flags to J, NEW-03 handler lock (waitLock), NEW-04 blank-row guard, m07 nested-IF SLA formula, 1-second dedup tolerance, timezone alert throttle (NEW-09, once/day), NEW-06 digest missing-tab email, B1 full-note matcher, M01 independent H/I, plus toETDate_ for the UTC timestamp offset found in the install test. Gemini's isSingleCell guard removal was REJECTED (Claude: premise backwards). verify-apps-script.js now covers all of it: 51 passed, 0 failed. Re-install of the 729-line file is in flight (browser task 12bce1e7, cloud browser, started 8:35 PM — the desktop Chrome task could not be updated from the iOS session, so a new cloud window was used; it does not touch the laptop RAM). Triggers are already installed and do not need reinstalling.

## Re-install report — patched file live (2026-11-24, 8:58 PM)

Browser task 12bce1e7 (cloud browser, 8:27–8:58 PM, signed in as frncsbryn54@gmail.com). The 729-line patched Code.gs was pasted in 6 chunks (line counts verified: 140, 280, 420, 560, 700, 729 — chunk 6 first read 730 from a trailing blank line, corrected to 729). Save result "Saved to Drive", no syntax errors. All 4 triggers still present and enabled (not reinstalled). Project timezone (GMT-05:00) Eastern Time – New York. Step 1 regression: normal PASS, invalid email PASS (J = "MISSING FIELD (Email) — welcome not sent."), blank name not testable via the live form (Name is a required question, so the form blocks it before the script runs), dedup re-run 22 min later created a NEW row by design (1-second tolerance; a fresh submit minutes later is a new row, and a true same-response re-run cannot be produced from the live form UI). Formula injection PASS ("=2+2" stored as literal text with the single-quote prefix, not evaluated to 4). Status-transition tests all PASS (hand note + Onboarded, Contacted → Onboarded → Contacted → Onboarded, New → Onboarded → New → Contacted → Onboarded). Cleanup done: DiagTest.gs deleted, scratch rows 3–6 deleted, 4 scratch Form responses deleted. Final state: Intake Log holds only Darius (row 2), Form shows exactly 1 response (Darius). ET timestamp display FAILED in the grid: column A still reads the UTC wall-clock (2026-11-25 01:33 etc.). Diagnosed: the Sheet itself renders datetimes in UTC — =NOW() read 11/25/2026 1:43 and SpreadsheetApp.getSpreadsheetTimeZone() returned an empty string, even though File > Settings shows "(GMT-05:00) Eastern Time" selected. The code is correct (toETDate_ verified identity-correct; the stored instants are the true submit instants). The Sheet timezone setting is not taking effect. The task did NOT change it, because doing so would shift the pre-existing Darius row's display (its stored instant is 2026-11-24T17:21:23Z = 12:21 EST, yet column A displays 17:21). Next step needs Bryan's decision: re-set the Sheet timezone to America/New_York in File > Settings so it takes effect (and correct Darius's stored Timestamp to 17:21 ET so it still reads 5:21 PM), then re-submit a test form and re-check column A. Until then, evening intakes display as the next day in column A, but the stored instants are correct and the SLA/digest math uses the true dates.

## Sheet timezone fix — DONE (2026-11-24, 9:11 PM)

Browser task 12bce1e7 (cloud browser, 9:05–9:11 PM, as frncsbryn54@gmail.com). The Sheet timezone was toggled in File > Settings (Eastern → Pacific, saved and reloaded, Pacific confirmed saved → back to "(GMT-05:00) Eastern Time", saved and reloaded). =NOW() in scratch cell L2 read 11/24/2026 21:07 (current Eastern time, not 02:07 UTC); scratch value deleted. Darius's A2 was re-entered as 11/24/2026 5:21:23 PM (formula bar now shows 11/24/2026 17:21:23) and still displays 2026-11-24 17:21; no other cell in row 2 changed. (A2's grid display read 17:21 both before and after the toggle — it never showed the 12:21 the old stored instant would have produced under Eastern — but the =NOW() check and the test submit confirm Eastern is now in effect.) Test submit "Test TZ Check" at 9:08 PM ET: new row 3 column A read 2026-11-24 21:08 (formula bar 11/24/2026 21:08:55), the current Eastern wall-clock time, not the next day; Status New, Start date blank. Before this fix evening submits read 2026-11-25 01:xx. Test row and Form response deleted. Final state: Intake Log holds only Darius (row 2, A2 2026-11-24 17:21), Form shows exactly 1 response (Darius Hemmorage, submitted 11/24/26, 5:21 PM). The timestamp display bug is closed.

## Final live QA pass — all PASS, no FAILs (2026-11-24, 9:28 PM)

Browser task 12bce1e7 (cloud browser, 9:11–9:28 PM, as frncsbryn54@gmail.com). All three parts complete. Darius row never edited; all test rows and Form responses deleted. Final state: Intake Log holds only Darius (row 2, Timestamp 2026-11-24 17:21, Contacted, Contacted on 2026-11-27), Form shows exactly 1 response (Darius, submitted 11/24/26, 5:21 PM).

PART 1 — Sheet / Dashboard: PASS on every item. Dashboard formulas recorded verbatim: B5 New =COUNTIF('Intake Log'!G:G,"New"); B6 Contacted =COUNTIF('Intake Log'!G:G,"Contacted"); B7 Onboarded =COUNTIF('Intake Log'!G:G,"Onboarded"); B8 Total =COUNTA('Intake Log'!A:A)-1 (all whole-column). B11 Oldest uncontacted (Name) =IFNA(INDEX('Intake Log'!B:B,MATCH(MINIFS('Intake Log'!A:A,'Intake Log'!G:G,"New"),'Intake Log'!A:A,0)),"None — no New intakes"). B12 Received and B13 Business days waiting are row-2-anchored, open-ended (MINIFS over A2:A / G2:G). B16 Average and B17 Median time to contact =IFERROR(AVERAGE/MEDIAN(FILTER(INT(I2:I)-INT(A2:A),(G2:G="Contacted")*(I2:I<>"")*(INT(I2:I)>=INT(A2:A)))),"No contacted intakes yet") — filters on G="Contacted" AND I<>"" AND INT(I)>=INT(A), so an Onboarded row carrying a Contacted on date is excluded (item a PASS). A21 Overdue FILTER =IFERROR(FILTER('Intake Log'!A2:F,(G2:G="New")*(A2:A<>"")*ISNUMBER(A2:A)*(TODAY()>WORKDAY(INT(A2:A),1))),"None — no overdue intakes"), spills downward from A21. (b) PASS: two live form submits (QA Blank TS, QA Text TS, 9:16/9:17 PM ET) — blank Timestamp + New left K blank (not OVERDUE); text Timestamp "not a date" + New left K blank (no #VALUE!); setting the blank-Timestamp row's date to 11/20/2026 correctly showed OVERDUE; newly appended rows get the guarded formula =IF(ISNUMBER(A{row}),IF(AND(G{row}="New",TODAY()>WORKDAY(INT(A{row}),1)),"OVERDUE",""),"") (verified verbatim on K3/K4). (c) PASS: newly appended row's Status cell (G3) opened a dropdown with New (selected), Contacted, Onboarded. (d) PASS: overdue FILTER spill area has no content below it (Dashboard rows 22–37 empty); with the 11/20/2026 row the overdue entry appeared at A21:F21 with rows 22+ still empty; Dashboard then read Total 3, New 2, Oldest uncontacted QA Blank TS / Received 2026-11-20 00:00 / 2 business days waiting. Sheet timezone re-confirmed via File > Settings: "(GMT-05:00) Eastern Time" (locale United States). Baseline Dashboard with only Darius: New 0, Contacted 1, Onboarded 0, Total 1; Oldest uncontacted "None — no New intakes" / "—" / "—"; Time to contact Average 3.0, Median 3.0; Overdue "None — no overdue intakes". NOT RUN: Saturday-intake test and zero-row test — both would require deleting the Darius row or leaving the log empty, which the assignment forbids. Observations (not defects): Darius's K2 still holds the older unguarded SLA formula =IF(AND(G2="New",TODAY()>WORKDAY(INT(A2),1)),"OVERDUE","") from before the patch; only newly appended rows get the guarded version. While scratch New rows had blank/text Timestamps, the Dashboard's Oldest uncontacted section read "None — no New intakes" even though New rows existed, because MINIFS over A:A returns 0 when no matching row has a numeric Timestamp. The overdue FILTER outputs 6 columns but only Timestamp and Name have headers (C–F unlabeled — cosmetic).

PART 2 — Portal demo: PASS on every item. Loads with no sign-in wall. Intake form matches the Google Form fields. Blank submit blocked ("Name is required.", "Email is required.", "Choose what you need.", "Please fix the highlighted fields." — no row added). Bad email blocked ("Enter a valid email address." for "not-an-email" — no row added). Valid submit (QA Portal Test / QA Co / qa@example.com / Automation build, start date left blank because the portal date field does not accept typed input) landed as a New row at 2026-11-24 21:26 ET; counts went to New 4 · Contacted 2 · Onboarded 1 · Total 7. Reset restores seed data (6 rows, New 3 · Contacted 2 · Onboarded 1 · Total 6); portal left reset to its original seed. Status change survives reload (Tom to New, Priya to Onboarded, both intact after reload). Dashboard on load in America/New_York reads Time to contact Average 1.0 days · Median 1.0 days (seed: Sam 2 days, Lena 0 days). Four fixed transitions, all PASS: Tom Onboarded → Contacted cleared the note, re-stamped Contacted on 2026-11-24, set Follow-up 2026-11-26; Tom Contacted → Onboarded re-added the close-out note dated 2026-11-24, then Onboarded → New kept that note while clearing Follow-up and Contacted on (and correctly flagged OVERDUE); Priya New → Onboarded left Contacted on blank and added the close-out note; Friday re-contact follow-up lands on Tuesday — Sam Whitfield's seed row shows Contacted on Friday 2026-11-20 with Follow-up Tuesday 2026-11-24 (2 business days, weekend skipped). Caveat: a live Friday re-contact cannot be performed on Tuesday 2026-11-24 because a re-contact re-stamps Contacted on to today, so the Friday case is verified from the seed fixture plus the +2-business-day math confirmed on the Tom/Lena re-contacts (Tue 11/24 → Thu 11/26). Minor portal quirks: the start-date field is a month/day/year picker that does not accept typed input, and the email error message stayed visible after correcting the email until the next submit (stale error text; the successful submit cleared it).

PART 3 — Apps Script live checks: PASS. All four triggers present and enabled: onIntakeSubmit — From form, On form submit (last run Nov 24, 2026, 9:17:00 PM, 5.88% error rate — pre-existing; tonight's QA submits ran); onStatusChange — From spreadsheet, On edit (last run Nov 24, 2026, 9:22:08 PM, 0%); onOnboarded — From spreadsheet, On edit (last run Nov 24, 2026, 9:22:08 PM, 0%); sendOverdueDigest — Time-based (no last run recorded yet, error rate "—"). Editor confirms Code.gs ends at line 729. Project timezone confirmed in Project Settings: "(GMT-05:00) Eastern Time – New York" (America/New_York). Step 1 regression and transition tests were NOT re-run, per the assignment (already passed in the last two installs).

## GitHub push — Steps 2–4 live (2026-11-24, ~9:27 PM)

Bryan approved the push ("Yes please", 9:12 PM). Pushed to flamingblackman/client-onboarding-workflow, main, commit 1e68d907: README.md, apps-script/Code.gs (729 lines), docs/runbook.md, qa-intensive-2026-11-24.md, verify-apps-script.js, loom-script-friday-build-log.md. README/runbook status lines updated to Steps 2–4 live; runbook K formula and dedup description corrected to the patched code (nested-IF SLA formula; dedup = same email + timestamp within 1 second). NOTE: Bryan does NOT want the Loom script in the public repo. It was included in the push by mistake (treated as a project doc). A delete attempt was declined on the approval card (9:28 PM). Awaiting Bryan's call on whether to retry the delete or leave it up. The Loom script stays local at ~/workspace/client-onboarding-workflow/loom-script-friday-build-log.md regardless.
