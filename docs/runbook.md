# Runbook — Client Onboarding Workflow

## What this is

A client intake pipeline: Google Form → Google Apps Script → Google Sheets, with status-driven follow-up and a live dashboard. Step 1 (intake) is live. Steps 2 (Contacted), 3 (Onboarded), and 4 (overdue digest) are live (installed Nov 24, 2026, with the stabilization patch).

History: this plan was originally written for Zapier (Nov 18, 2026) and moved to Google Apps Script on Nov 24, 2026, at Bryan's direction — the script replaces the Zapier automation in the pipeline. Do not confuse this with the lead-tracking Zap, a separate Zapier flow that is paused (Zapier trial expired) and has nothing to do with client onboarding.

Built with AI assistance and directed by Bryan Francis. He does not hand-write code.

## Accounts — read this first

- **The Sheet "Client Onboarding Intake Log" is BUSINESS-owned (Bfrancis360AI@gmail.com), ID `1Bl4Of8_4h9detzvHw5gfcTpEYCoraryBpJuIkHGZm-Y`.** It is shared to the personal account (frncsbryn54@gmail.com) as Editor. The script writes to it as personal through that share. Do not claim the Sheet lives in personal.
- **The Form "Client Onboarding — Intake" is personal-owned (frncsbryn54@gmail.com), ID `1d5Ui42EhK72jHhHDAyo5855i86nSRVF_gtJBDDagERo`.** It is shared to business as Editor.
- **The script is bound to the Form and runs as personal (frncsbryn54@gmail.com).** Both emails go out FROM personal: the alert to Bfrancis360AI@gmail.com, the welcome to the client. If Bryan later wants the emails sent from the business identity, the script must be rebuilt as business — the saved business password was rejected by Google on Nov 24, so that route needs Bryan signing in himself or a fresh password through the Secure Vault.
- **The Form's native "Link to Sheets" must NOT be used.** The script is the link between the Form and the Sheet. If the Form is linked anyway, responses also land in a "Form Responses 1" tab; that is harmless but the Intake Log stays the single source of truth.
- **Timezone: every date in the script and the Sheet is America/New_York.** The Apps Script project timezone must be set to America/New_York (Project Settings) — see QA-M09. The Sheet timezone must also be America/New_York (File > Settings).
- **Apps Script has no CLI route in this workspace** (`hatch_gws_cli script` is blocked). The script is edited in the browser editor only. Local source: `~/workspace/client-onboarding-workflow/apps-script/Code.gs` — this is the source to install from. Live now runs the 729-line patched build (installed Nov 24, 2026), matching the local file. Sync the local copy verbatim after every live edit and re-check after each step install.

## The Sheet (live)

- URL: https://docs.google.com/spreadsheets/d/1Bl4Of8_4h9detzvHw5gfcTpEYCoraryBpJuIkHGZm-Y/edit
- ID: `1Bl4Of8_4h9detzvHw5gfcTpEYCoraryBpJuIkHGZm-Y`
- Tabs: `Intake Log`, `Dashboard`.

### Intake Log columns

| Column | Header | Who writes it |
|---|---|---|
| A | Timestamp | Step 1 (form response time) |
| B | Name | Step 1 |
| C | Company | Step 1 |
| D | Email | Step 1 |
| E | What they need | Step 1 (catalog value) |
| F | Start date | Step 1 |
| G | Status | Step 1 stamps `New`; Bryan changes it by hand; validated to New / Contacted / Onboarded |
| H | Follow-up date | Step 2 sets it; Step 3 clears it |
| I | Contacted on | Step 2 stamps it |
| J | Notes / Close-out | Step 3 writes the close-out; Bryan can add notes by hand |
| K | SLA flag | Per-row formula written by Step 1 at append time. Never write a column-wide ARRAYFORMULA in K (see Live fixes). `OVERDUE` appears on any row still New more than one business day after its timestamp. |

### Dashboard formulas (live)

- Counts: COUNTIF on Status (New / Contacted / Onboarded / Total).
- Oldest uncontacted intake: MINIFS on Timestamp where Status is New, name via INDEX/MATCH, business days waiting via `IF(TODAY()<=INT(A),0,NETWORKDAYS(INT(A)+1,TODAY()))` (weekdays strictly after the timestamp date through today; the old NETWORKDAYS-minus-1 undercounted weekend intakes by 1).
- Time to contact: average and median of INT(Contacted on) minus INT(Timestamp), whole days, for rows currently Contacted with a Contacted on date (`I<>""`). Whole days on purpose: Contacted on is a date, Timestamp is a datetime, and mixing them gave a misleading negative value for same-day contacts during testing. A Contacted row with a blank Contacted on is excluded, so it cannot poison the average.
- Overdue list: FILTER of New rows whose timestamp is more than one business day old, using the same WORKDAY test as the per-row SLA flag (`TODAY()>WORKDAY(INT(A),1)`), with a non-blank numeric Timestamp guard (`ISNUMBER(A)`, `A<>""`).

## Deployment Checklist

### A. The Form (built Nov 18, live)

1. In Google Forms, a form titled **Client Onboarding — Intake** (personal-owned).
2. Description: `Tell me about the work you need. I reply within one business day. — Bryan Francis, BFrancis360`
3. Questions, in this order:
   - **Name** — Short answer, required.
   - **Company** — Short answer, optional.
   - **Email** — Short answer, required. Helper text: `Please double-check your email address`. (Forms has no built-in email validation for this question type; the script uses the address as given.)
   - **What they need** — Multiple choice (radio), required. Options, in order: `Automation build`, `RevOps setup`, `Workflow audit`, `Other`.
   - **Start date — when would you like the work to begin?** — Date question, include year, no time, optional.
4. The Form is NOT linked to the Sheet (see Accounts above).
5. Responder link: https://docs.google.com/forms/d/e/1FAIpQLSenv-svvx6zaJtZQpnVzeSIHZ7N-I5j4BWtEdFgloG7xled0Q/viewform

### B. Step 1 — Intake (live)

Script project: https://script.google.com/u/0/home/projects/1FylWhXA5SKfE_7TN7AuG9qUk2-NnvulSmAZJs8Knyk0xRuvUEJrLC2uB/edit
Bound to the Form above. Local source: `~/workspace/client-onboarding-workflow/apps-script/Code.gs`.

1. Trigger: installable `onFormSubmit` on the Form — function `onIntakeSubmit`, event source "From form", event type "On form submit", enabled. Authorized as frncsbryn54@gmail.com (Gmail + Sheets + Forms scopes).
2. On submit, the function reads the answers through `namedValuesMap(e)` (see Live fixes for the fallback), then:
   - Under a script lock, checks for a duplicate (same email + timestamp within 1 second) and skips the row and the welcome if found (the alert still goes out, marked DUPLICATE). Otherwise writes the row at the first empty row (`getLastRow() + 1`), columns A–K in a single `setValues`: Timestamp = response submitted time, Name, Company, Email, What they need, Start date (parsed to a real date by `parseFormDate`), Status = `New`, Follow-up date, Contacted on, and Notes / Close-out blank, plus a per-row SLA formula in column K: `=IF(ISNUMBER(A{row}),IF(AND(G{row}="New",TODAY()>WORKDAY(INT(A{row}),1)),"OVERDUE",""),"")`.
   - Sends the alert email with GmailApp.sendEmail, FROM personal, TO Bfrancis360AI@gmail.com. The email is trimmed and validated first; a blank or invalid client email means no welcome goes out and the alert carries a MISSING FIELD marker instead. Each send is in its own try/catch, so an alert failure cannot kill the welcome and vice versa; a failed welcome is flagged in Notes / Close-out.
     - Subject: `New client intake: [Name] — [What they need]`
     - Body:
       ```
       New intake on the Client Onboarding form.

       Name: [Name]
       Company: [Company]
       Email: [Email]
       What they need: [What they need]
       Start date: [Start date]
       Received: [Timestamp]

       Log: https://docs.google.com/spreadsheets/d/1Bl4Of8_4h9detzvHw5gfcTpEYCoraryBpJuIkHGZm-Y/edit
       Status is New until you contact them. Reply within one business day.
       ```
   - Sends the welcome email with GmailApp.sendEmail, FROM personal, TO the client's Email:
     - Subject: `Thanks — I'll reply within one business day`
     - Body:
       ```
       Hi [Name],

       Thanks for reaching out about [What they need]. I've got your note and I'll reply within one business day.

       If anything changes before then, just reply to this email.

       Bryan Francis
       BFrancis360
       Bfrancis360AI@gmail.com
       ```
3. The Dashboard is live formulas. Adding the row updates it.

### C. Step 2 — Contacted (live)

Design: its own installable onEdit trigger on the Sheet, function `onStatusChange` — separate from Step 3's `onOnboarded` trigger. Both watch Status (column G); each returns early unless the new value is its own status.

1. Trigger: installable onEdit on the Sheet — function `onStatusChange`, event source "From spreadsheet", event type "On edit", enabled. It fires when Bryan changes a Status cell by hand (including a multi-cell paste; every edited row is handled).
2. Condition: Status is `Contacted` (trimmed, case-insensitive) AND Contacted on is empty.
3. Action: stamp Contacted on = today (yyyy-mm-dd, America/New_York) and set Follow-up date = 2 business days after today (skip Saturday and Sunday), leaving a hand-entered Follow-up date alone. The business-day math is `addBusinessDays` in the script; it is AI-generated, Bryan directs it and tests it. He does not hand-write it. Re-contacting a row clears a stale machine close-out note but keeps hand-written notes.
4. Loop guard: the handler returns unless the edited range includes the Status column (G), so its own writes to H/I/J never re-trigger it. The Contacted-on condition is the idempotency guard: re-touching Status does not re-stamp.
5. Revert: changing Status back to `New` clears Contacted on and Follow-up date and keeps Notes as a preserved record (a machine close-out note is marked "Previous onboarding ..." so a later Onboarded writes a fresh note).
6. The first Step 2 build went live Nov 24; the stabilization patch (guard fix, formula-injection sanitize, ET timestamp, handler lock, and more) was installed 8:58 PM Nov 24.

### D. Step 3 — Onboarded (live)

Design: its own installable onEdit trigger on the Sheet, function `onOnboarded` — separate from Step 2's `onStatusChange` trigger. Both watch Status (column G); each returns early unless the new value is its own status.

1. Trigger: installable onEdit on the Sheet — function `onOnboarded`, event source "From spreadsheet", event type "On edit", enabled.
2. Condition: Status is `Onboarded` (trimmed, case-insensitive) AND Notes / Close-out does not already carry the machine close-out note (`Onboarded yyyy-mm-dd — ...`). A hand-written note does not block the close-out.
3. Action: set Notes / Close-out to `Onboarded [today's date, yyyy-mm-dd] — welcome complete; no further follow-up.` (appended after a hand-written note, not overwriting it). Clear Follow-up date (set it empty). Contacted on is kept.
4. Loop guard: the handler returns unless the edited range includes the Status column (G). The machine-note check is the idempotency guard: re-touching Status does not rewrite the note.

### E. Step 4 — Overdue digest (live)

Design: a time-driven trigger.

1. Trigger: time-driven, every weekday at 9:00 AM ET — function `sendOverdueDigest`. The code also returns early on Saturday/Sunday as a guard.
2. Action: read the Intake Log and keep New rows where today is more than one business day after the row's Timestamp. A Timestamp stored as text or a serial number is parsed; only a still-unparseable Timestamp is skipped (and logged).
3. Action: send the digest email with GmailApp.sendEmail, ONLY if at least one overdue row exists. FROM personal, TO Bfrancis360AI@gmail.com.
   - Subject: `Overdue intakes: [count] New over 1 business day`
   - Body: one line per overdue row — name, what they need, received date, business days waiting — then the Dashboard link (same Sheet URL as above).
4. Verify in the build that every overdue row is included, not just the first.

### F. End-to-end test (do this before calling a step done)

1. Submit a test intake through the live form using **Bfrancis360AI@gmail.com** as the client, name `Test Intake`. No real person gets emailed.
2. Check the Intake Log row landed with Status `New` and a per-row SLA formula in K (the formula is the flag; it reads blank until the row is overdue).
3. Check both emails arrived: the alert to Bryan and the welcome to the test address.
4. (After Step 2 is installed live) Change the test row's Status to `Contacted`. Check Follow-up date fills in 2 business days out and Contacted on stamps today.
5. (After Step 3 is installed live) Change the test row's Status to `Onboarded`. Check the close-out note appears and Follow-up date clears.
6. Check the Dashboard counts and time to contact update.
7. Delete the test row so the log starts clean. Also delete the test response from the Form's Responses tab, or the Form and the Sheet will disagree on the count — the Form keeps every response; the Sheet is the working log.

## Test evidence

### Sheet only (Nov 18, 2026)

The Form and the automation were not built yet, so the Sheet was tested by writing rows through the Sheets API exactly as Step 1 would, then deleting them.

- Appended two test rows to the Intake Log via the API. They landed in rows 2 and 3.
- Row 1 (timestamp Nov 13, 10:00 AM, Status New): SLA flag computed `OVERDUE`. Dashboard showed New 1, oldest uncontacted = Test Client Overdue, 3 business days waiting, and the overdue list showed the row.
- Row 2 (timestamp Nov 18, 06:30, Status Contacted, Contacted on Nov 18, Follow-up date Nov 20): SLA flag blank. Dashboard showed Contacted 1, Total 2.
- First version of the time-to-contact formula returned -0.3 days for a same-day contact, because Contacted on is a date and Timestamp is a datetime. Fixed by comparing whole days (INT on both sides). Re-read: average and median 0.0 days. Correct.
- First version of the overdue list showed the timestamp as a raw serial (46339.41667). Fixed by applying the datetime number format to the FILTER output area. Re-read: `2026-11-13 10:00`. Correct.
- Deleted both test rows. Re-read: Intake Log holds headers only; Dashboard shows New 0, Contacted 0, Onboarded 0, Total 0, "None — no New intakes", "No contacted intakes yet", "None — no overdue intakes". The log starts clean.

### Live fixes (Nov 24, 2026)

- **namedValues fallback.** The first live trigger run arrived with `e.namedValues` empty: the Sheet row landed with timestamp + Status New and every other field blank, the alert went out with all fields blank, and the welcome email never sent (no recipient). The script now falls back to `e.response.getItemResponses()` for any missing title, with `responseValueString` normalizing date answers (Date objects) to `yyyy-mm-dd`. Verified on the second live run: full row, full alert, welcome sent.
- **Per-row SLA formula.** A column-wide ARRAYFORMULA in K breaks appends: it extends the data range, so new rows landed at rows 999–1000 and the log looked empty at the top. The ARRAYFORMULA was cleared and the script now writes a per-row formula in K at append time (see Step 1). Never use a column-wide ARRAYFORMULA in K again.
- **Form/Sheet count mismatch.** Test rows deleted from the Sheet stay as responses in the Form, so the Form showed 4 responses while the Sheet showed 1 row. The Form has no API delete; the 3 test responses were deleted by hand in the Form's Responses tab, keeping the one row Bryan asked to keep (Darius Hemmorage). The Form is the raw intake record; the Sheet is the working log. Delete test data in both places.

## Maintenance

- **Sheet schema changes:** If you add or rename columns, update the field mapping in Step 1 (Code.gs) and the Dashboard formulas. Mapping drift after a sheet edit is the most common silent failure.
- **Service catalog changes:** If you add or remove a "What they need" option, update the Form question, the Sheet dropdown validation on the Intake Log, and the README table, all three.
- **Follow-up window:** The 2-business-day follow-up in Step 2 is a chosen default, not a client promise. Change it in the Step 2 helper if the working rhythm changes.
- **Trigger status:** Triggers stay on until turned off. If the onFormSubmit trigger is disabled, intakes pile up in the Form with no log rows and no emails; the Form still accepts responses, so check the trigger and the Executions log first when rows stop appearing.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Intake submitted but no row in the log | Trigger disabled or missing, or the Sheet share revoked | In the script editor, check Triggers (onIntakeSubmit, From form, On form submit, enabled) and the Executions log for the failed run |
| Row logged but no emails | Gmail send failed, or the script authorization lapsed | Check the Executions log for the run; re-authorize the script as personal if the scopes were revoked |
| New row landed at row 999 | Column-wide ARRAYFORMULA in K | Delete the ARRAYFORMULA from K2 and any stray rows at the bottom; never restore it — Step 1 writes a per-row formula |
| Follow-up date not set after Contacted | Step 2 trigger disabled | Check the Triggers list (onStatusChange, From spreadsheet, On edit, enabled) and the Executions log; stamp by hand until the trigger is fixed |
| Close-out note missing after Onboarded | Step 3 trigger disabled, or Notes already carries the machine close-out note | Check the Triggers list (onOnboarded, From spreadsheet, On edit, enabled); write the note and clear Follow-up date by hand until the trigger is fixed |
| Overdue row not flagged | K cell has no formula, or Timestamp is not a real datetime | Check the K cell carries the per-row formula; check the Timestamp cell is a datetime value, not text; weekends do not count |
| Dashboard shows a serial number instead of a date | Number format lost on the FILTER output area | Re-apply yyyy-mm-dd hh:mm to Dashboard A21:A100 |
| Time to contact looks negative | A Contacted on value with a time component, or a future Timestamp | Contacted on must be a date; the formula compares whole days (INT) on both sides |

## Failure Modes Considered

- Form submitted with a bad email → the welcome email bounces; the row is still logged and the alert to Bryan still fires, so nothing is lost silently. Bryan replies from the alert instead.
- Step 1 writes the row but the Gmail send fails → the intake is in the log as New and shows on the Dashboard; the failure shows in the Apps Script Executions log. Better logged-than-lost.
- Bryan changes Status by hand with a typo → the scripts normalise the value (trim + case-insensitive), so `contacted` and `Contacted ` still stamp. A value that is not New / Contacted / Onboarded at all is ignored by every handler and every monitor, so the dropdown validation is still the first line of defence; check the Status cell when a row is invisible.
- First trigger run with empty `e.namedValues` → the fallback reads the answers from `e.response`, so no intake is lost to a blank event object (see Live fixes).
- Sheet edited while the script runs → the script computes the first empty row when the trigger fires; do not insert rows by hand in the log while a submission is landing.

## Known limitations

- All four steps are live (installed Nov 24, 2026, with the stabilization patch). The Sheet timezone is America/New_York (re-set Nov 24 after it was found running UTC under the hood); evening intakes display as the correct Eastern date.
- The script runs as personal, so both emails go out from frncsbryn54@gmail.com. Sending from the business identity needs a rebuild as business.
- Apps Script has no CLI route in this workspace; every script change goes through the browser editor, and the local copy must be synced by hand after each edit.
- The native Form-to-Sheet link is intentionally unused; the script is the link. If the script is ever disabled, the fallback is the native link plus a script that watches the responses tab.
- The Form has no API delete for responses; test responses must be removed by hand in the Responses tab.
