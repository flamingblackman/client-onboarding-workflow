// Client Onboarding — Intake Automation (replaces Zap 1)
// Bound to the "Client Onboarding — Intake" Form (personal account).
// Trigger: installable onFormSubmit on that Form.
// Runs as frncsbryn54@gmail.com (personal) for tonight. The Sheet it writes
// to is business-owned and shared to personal as Editor. If Bryan later
// wants the emails sent from the business identity, rebuild it as business.
// Written with AI assistance and directed by Bryan Francis. He does not
// hand-write code; the Zapier JavaScript it replaces was AI-generated too.
//
// QA fixes applied 2026-11-24 (see qa-intensive-2026-11-24.md):
// B1 — Step 3 guard now tests for the machine close-out note, not any text
//   in J; a hand-written note no longer defeats the close-out, and the
//   close-out note is appended after a hand note instead of overwriting it.
// M01 — Step 2 guard now tests Contacted on (I), not Follow-up date (H);
//   a hand-entered Follow-up date no longer blocks the Contacted stamp, and
//   a hand-entered Follow-up date is left alone.
// M02 — Email is trimmed and validated; each send is in its own try/catch
//   so an alert failure cannot kill the welcome and vice versa; a failed
//   welcome is flagged in J instead of dying silently.
// M03 — Script lock around row-pick + write, plus a dedup scan (same email
//   + same received minute); a duplicate skips the row and the welcome but
//   still sends a DUPLICATE-marked alert.
// M04 — Status is normalised (trim + case-insensitive) before comparing, in
//   both handlers and the digest.
// M05 — Bulk / multi-cell edits are handled row by row, not just the top
//   row of the edited range.
// M06 — Re-contacting a row clears a stale machine close-out note (hand
//   notes are kept).
// M07 — Reverting Status to New clears Contacted on and Follow-up date and
//   keeps Notes as a preserved record; the preserved close-out note is
//   marked "Previous onboarding ..." so a later Onboarded writes a fresh
//   note instead of keeping the stale date.
// M08 — Digest parses text and serial-number Timestamps instead of
//   silently dropping those rows; only a still-unparseable Timestamp is
//   skipped (and logged).
// M09 — All dates are America/New_York. The Apps Script project timezone
//   must also be America/New_York (Project Settings, which sets "timeZone"
//   in appsscript.json); the code emails Bryan an alert when it is not,
//   instead of only logging. See QA-M09 and the Claude review.
// M10 — Null guards: a trigger run without an event object, or a renamed
//   Intake Log tab, logs and alerts instead of throwing and losing the
//   intake.
// m01 — parseFormDate validates month/day and round-trips the date; invalid
//   input returns '' instead of rolling forward or passing text through.
// m02 — Prefix tolerance covers all five question titles, and the fallback
//   guard tests the first element, not array truthiness.
// m03 — Digest has a weekday guard (returns on Sat/Sun) in addition to the
//   Mon–Fri trigger schedule.
// m04 — Each step writes in a single setValues call where possible.
// m05 — Blank Name / Email fall back to '(no name)' / '(no need)' in the
//   alert; no blank welcome goes out (the welcome requires a valid email
//   AND a non-blank name).
// m06/m07 — The per-row SLA formula guards with ISNUMBER, so a blank
//   Timestamp reads blank (not OVERDUE) and a text Timestamp reads blank
//   (not #VALUE!).
//
// Claude second-opinion patch, 2026-11-24 (review of the QA report and the
// fixed file above; chat https://claude.ai/chat/15e50dfd-d800-4a9c-bdf7-0f3a05d276ec):
// Bug 1 (re-contact regression, most important) — the first fix let the
//   Contacted-on guard return on Onboarded → Contacted, so H was never
//   re-stamped and the stale note never cleared. The Contacted branch now
//   strips a machine close-out note and clears Contacted on BEFORE the
//   guard, so a re-contact re-stamps fresh.
// Bug 2 (Step 3 early return) — onOnboarded returned before clearing H when
//   a machine note already existed. It now always clears H on Onboarded.
// Bug 3 (blank welcome) — a blank name with a valid email still sent
//   "Hi ,". The welcome now requires a non-blank name, and a blank need
//   reads "your inquiry" in the welcome body.
// M03 — SpreadsheetApp.flush() before releaseLock(); the dedup now keys on
//   an exact timestamp match (same response re-run) so a client correcting
//   a typo seconds later is not dropped; a failed row write alerts Bryan
//   and sends no welcome.
// M04 — the canonical status is now written back to G when the cell holds a
//   case/whitespace variant, so K and the Dashboard COUNTIFs see it.
// M07 — the revert wipe is skipped when a single-cell edit re-selects New
//   (e.oldValue already New); bulk pastes still apply the revert.
// M09 — checkTimezone_ now emails Bryan an alert instead of only logging.
// Claude's verdict: install Step 4 first (after confirming the project and
// Sheet timezones are America/New_York); hold Step 3 until Bugs 1 and 2 are
// patched (done here); do not paste the whole file over live Step 2 until
// Bug 1 is fixed and the timezone is pinned. It also put the QA report's
// true defect count nearer 26–27 than 32 (several findings overstated or
// duplicated).
//
// Stabilization patch, 2026-11-24 (ChatGPT second opinion + Claude review
// of reviews; Gemini's guard-removal recommendation was rejected by Claude
// as backwards, so the isSingleCell revert guard stays):
// NEW-01 — formula injection: client Name/Company/Email/Need are sanitized
//   (a leading ' forces text) before setValues, so a value starting with
//   '=' cannot run as a spreadsheet formula.
// M08 — digest date parsing: date-only strings and serials now parse as the
//   ET calendar date (parseSheetDate_), not a UTC instant that reads a day
//   early in ET. Only hand-made rows are affected; Step 1 writes real Dates.
// Bug 4 (M02) — send failures are no longer swallowed: the alert and
//   welcome sends are tracked, failure flags are APPENDED to J (never
//   overwriting a hand note), and the handler rethrows at the end if any
//   send failed so the failure is visible instead of only in Logger.
// NEW-03 — the two status handlers now share a script lock (waitLock), so a
//   quick Contacted→Onboarded flip cannot let a delayed Step 2 write land
//   after Step 3 cleared H.
// NEW-04 — bulk edits skip blank rows (no Timestamp in A), so dragging the
//   Status dropdown past the data cannot stamp dates into empty rows.
// m07 — the per-row SLA formula now uses a nested IF instead of
//   AND(ISNUMBER(...)), because Sheets' AND evaluates every argument and a
//   text Timestamp still returned #VALUE!.
// Dedup — the timestamp match now allows a 1-second tolerance (Claude
//   review of reviews), so a true duplicate is not missed by a millisecond
//   after the Sheets round trip, while a client correction seconds later is
//   still a new row.
// NEW-09 — the timezone alert is throttled to once per day, so a wrong
//   timezone cannot burn the daily Gmail quota the welcome emails need.
// NEW-06 — the digest emails Bryan when the Intake Log tab is missing,
//   instead of only logging.
// B1 — the machine-note matcher now tests the FULL close-out sentence, not
//   just the "Onboarded yyyy-mm-dd —" prefix.
// M01 — Step 2 validates H and I independently: a Contacted row with I
//   filled and H blank now gets its follow-up (2 business days after the
//   contacted date), and vice versa.

var SHEET_ID = '1Bl4Of8_4h9detzvHw5gfcTpEYCoraryBpJuIkHGZm-Y';
var LOG_TAB = 'Intake Log';
var ALERT_TO = 'Bfrancis360AI@gmail.com';
var SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Bl4Of8_4h9detzvHw5gfcTpEYCoraryBpJuIkHGZm-Y/edit';
var TZ = 'America/New_York';

function todayET() {
  // Today at midnight, from ET calendar fields. The Apps Script project
  // timezone must also be America/New_York (Project Settings) so Date
  // values written to the Sheet land on the ET day. See QA-M09.
  var parts = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd').split('-');
  return new Date(+parts[0], +parts[1] - 1, +parts[2]);
}

function formatDateET(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function toETDate_(d) {
  // The Form response timestamp, when written to the Sheet as-is, displays
  // as the UTC wall-clock (an 8:09 PM ET submit reads as 01:09 the next
  // day), so evening intakes are treated as the next day by the SLA formula
  // and the digest. Found in the live install test, 2026-11-24. Rebuild the
  // Date from its ET calendar fields so the Sheet (America/New_York)
  // displays the ET wall-clock time.
  var parts = Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss').split(/[- :]/);
  return new Date(+parts[0], +parts[1] - 1, +parts[2], +parts[3], +parts[4], +parts[5]);
}

function checkTimezone_() {
  // Alert (not just log) if the project timezone drifted from ET, since
  // nobody reads the execution log. The project timezone must be
  // America/New_York (Project Settings, which sets "timeZone" in
  // appsscript.json). See QA-M09 and the Claude review. Throttled to one
  // alert per day (NEW-09) so a wrong timezone cannot burn the daily Gmail
  // quota the welcome emails need.
  try {
    if (Session.getScriptTimeZone() !== TZ) {
      Logger.log('WARNING: script timezone is ' + Session.getScriptTimeZone() + ', expected ' + TZ + '. Date stamps may be a day off.');
      var todayKey = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
      var lastAlert = '';
      try { lastAlert = PropertiesService.getScriptProperties().getProperty('tzAlertDate') || ''; } catch (e2) { lastAlert = ''; }
      if (lastAlert === todayKey) return;
      try { PropertiesService.getScriptProperties().setProperty('tzAlertDate', todayKey); } catch (e3) { /* best effort */ }
      GmailApp.sendEmail(ALERT_TO, 'Client Onboarding: script timezone is wrong',
        'The Apps Script project timezone is ' + Session.getScriptTimeZone() + ', expected ' + TZ + ' (America/New_York).\n\nDate stamps (Contacted on, Follow-up date, close-out note) may land a day off until the project timezone is set to America/New_York in Project Settings.\n\nLog: ' + SHEET_URL);
    }
  } catch (err) { /* Session unavailable in some contexts */ }
}

function sanitizeForSheet_(v) {
  // NEW-01 (formula injection): setValues stores a string starting with '='
  // as a formula, so a client value like =IMPORTXML(...) could run and leak
  // other rows. Prefix with a single quote to force literal text. Also
  // covers '+'/'-'/'@', which some parsers treat as formula starts. The
  // K-column SLA formula is built by the script, never from client input,
  // so it is not sanitized.
  var s = String(v == null ? '' : v);
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

function normalizeStatus_(v) {
  // Trim + case-insensitive match to the canonical status, or '' when the
  // value is not a recognised status. See QA-M04.
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === 'new') return 'New';
  if (s === 'contacted') return 'Contacted';
  if (s === 'onboarded') return 'Onboarded';
  return '';
}

function hasCloseOutNote_(text) {
  // True when the Notes cell already carries the machine close-out note.
  // Matches the FULL machine sentence (B1, tightened in the stabilization
  // patch), so a hand note like "Onboarded 2026-11-20 — called" no longer
  // matches. The machine note is 'Onboarded yyyy-mm-dd — welcome complete;
  // no further follow-up.'
  return /(^|\n)Onboarded \d{4}-\d{2}-\d{2} — welcome complete; no further follow-up\./.test(String(text || ''));
}

function stripCloseOutNote_(text) {
  // Remove the machine close-out note line(s); keep any hand-written notes.
  var lines = String(text || '').split('\n');
  var kept = [];
  for (var i = 0; i < lines.length; i++) {
    if (!/^Onboarded \d{4}-\d{2}-\d{2} — welcome complete; no further follow-up\./.test(lines[i])) kept.push(lines[i]);
  }
  return kept.join('\n');
}

function markCloseOutNotePreserved_(text) {
  // On a revert to New, mark the machine close-out note as a preserved
  // record so a later Onboarded writes a fresh note instead of keeping the
  // stale date. See QA-M07.
  var lines = String(text || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    lines[i] = lines[i].replace(/^Onboarded (\d{4}-\d{2}-\d{2} — welcome complete; no further follow-up\.)/, 'Previous onboarding $1');
  }
  return lines.join('\n');
}

function editedStatusRows_(e) {
  // Rows whose Status (G) was in the edited range, for bulk pastes. Returns
  // [{row, status}] with the status as written. See QA-M05. Skips blank
  // rows (no Timestamp in A, NEW-04), so dragging the Status dropdown past
  // the data cannot stamp dates into empty rows and push getLastRow() down.
  var range = e.range;
  var startRow = range.getRow();
  var endRow = range.getLastRow();
  var startCol = range.getColumn();
  var endCol = range.getLastColumn();
  if (endCol < 7 || startCol > 7) return [];
  var sheet = range.getSheet();
  var values = sheet.getRange(startRow, 1, endRow - startRow + 1, 7).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var ts = values[i][0];
    if (ts === '' || ts === null || ts === undefined) continue;
    out.push({ row: startRow + i, status: values[i][6] });
  }
  return out;
}

function parseSheetDate_(v) {
  // M08 (stabilization patch): parse a Timestamp as the ET calendar date.
  // A date-only string ('2026-11-23') and a whole-number serial must NOT
  // go through new Date(...), which reads them as a UTC instant (midnight
  // UTC = 19:00 ET the previous day), so the row would flag overdue a day
  // early with a +1 waiting count. Step 1 always writes a real Date, so
  // this only touches hand-made rows. Returns a Date at local midnight, or
  // null when the value is blank or unparseable.
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && v.trim()) {
    var p = v.trim().split('-');
    if (p.length === 3) {
      var y = +p[0], m = +p[1], d = +p[2];
      if (y && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        var dt = new Date(y, m - 1, d);
        if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) return dt;
      }
      return null;
    }
    var parsed = new Date(v);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof v === 'number') {
    // Sheets serial: days since 1899-12-30 (1900 system). The integer part
    // is the ET calendar date. Add it to the epoch in local time so a
    // whole-number serial reads as that date, not the previous day.
    var base = new Date(1899, 11, 30);
    var dt2 = new Date(base.getTime());
    dt2.setDate(base.getDate() + Math.floor(v));
    return dt2;
  }
  return null;
}

function onIntakeSubmit(e) {
  if (!e || !e.response) {
    Logger.log('onIntakeSubmit called without an event/response; nothing logged.');
    return;
  }
  checkTimezone_();
  var r = e.response;
  var values = namedValuesMap(e);
  var name = firstValue(values, ['Name']);
  var company = firstValue(values, ['Company']);
  var email = String(firstValue(values, ['Email']) || '').trim();
  var need = firstValue(values, ['What they need']);
  var startDate = firstValue(values, ['Start date']);
  var timestamp = toETDate_(r.getTimestamp());

  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(LOG_TAB);
  if (!sheet) {
    try {
      GmailApp.sendEmail(ALERT_TO, 'Client Onboarding: Intake Log tab missing',
        'A client submitted the intake form but the "' + LOG_TAB + '" tab was not found in the Sheet.\n\nName: ' + name + '\nEmail: ' + email + '\nWhat they need: ' + need + '\n\nLog: ' + SHEET_URL);
    } catch (err) { Logger.log('Missing-tab alert failed: ' + err.message); }
    return;
  }

  var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  var missing = [];
  if (!name) missing.push('Name');
  if (!emailOk) missing.push('Email');

  // Lock + dedup (QA-M03): serialise row-pick + write so concurrent submits
  // cannot land on the same row, and skip a re-run of an intake already in
  // the log (same email + same received minute).
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(10000);
  } catch (err) { locked = false; }
  if (!locked) {
    Logger.log('onIntakeSubmit: could not get the script lock; intake not logged.');
    try {
      GmailApp.sendEmail(ALERT_TO, 'Client Onboarding: intake NOT logged (lock)',
        'A client submitted the intake form but the script could not get its lock, so the row was not written.\n\nName: ' + name + '\nEmail: ' + email + '\nWhat they need: ' + need + '\n\nLog: ' + SHEET_URL);
    } catch (err2) { Logger.log('Lock-failure alert failed: ' + err2.message); }
    return;
  }
  var row = -1;
  var isDup = false;
  var writeError = null;
  try {
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var existing = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
      for (var i = 0; i < existing.length; i++) {
        var exTs = existing[i][0];
        var exEmail = String(existing[i][3] || '').trim().toLowerCase();
        // Timestamp match with a 1-second tolerance (stabilization patch,
        // Claude review of reviews): the same response re-run has the same
        // timestamp, but the Sheets round trip can shift it by a
        // millisecond, so an exact === could miss a true duplicate. A
        // client correcting a typo seconds later is still a new row.
        if (exEmail && exEmail === email.toLowerCase() && exTs instanceof Date &&
            Math.abs(exTs.getTime() - timestamp.getTime()) < 1000) {
          isDup = true;
          break;
        }
      }
    }
    if (!isDup) {
      row = sheet.getLastRow() + 1;
      // One atomic write for A–K (the K value is a formula string, so
      // setValues stores it as a formula). A column-wide ARRAYFORMULA in K
      // breaks appends: it makes the sheet think the table runs to the
      // bottom, so new rows land at row 999. See QA-m04, QA-m06/m07.
      var slaFormula = '=IF(ISNUMBER(A' + row + '),IF(AND(G' + row + '="New",TODAY()>WORKDAY(INT(A' + row + '),1)),"OVERDUE",""),"")';
      try {
        sheet.getRange(row, 1, 1, 11).setValues([[
          timestamp, sanitizeForSheet_(name), sanitizeForSheet_(company), sanitizeForSheet_(email), sanitizeForSheet_(need), parseFormDate(startDate),
          'New', '', '', '', slaFormula
        ]]);
      } catch (err) {
        writeError = err;
        row = -1;
      }
    }
  } finally {
    // Flush before releasing the lock, so the next execution cannot read a
    // stale getLastRow() (Claude M03).
    try { SpreadsheetApp.flush(); } catch (e2) { /* ignore */ }
    lock.releaseLock();
  }
  if (writeError) {
    // Row not logged: alert Bryan and do not send the welcome (Claude M03).
    try {
      GmailApp.sendEmail(ALERT_TO, 'Client Onboarding: intake NOT logged (write failed)',
        'A client submitted the intake form but the row write failed, so the intake was not logged and no welcome was sent.\n\nName: ' + name + '\nEmail: ' + email + '\nWhat they need: ' + need + '\nError: ' + writeError.message + '\n\nLog: ' + SHEET_URL);
    } catch (err2) { Logger.log('Write-failure alert failed: ' + err2.message); }
    return;
  }
  // The Dashboard is live formulas. Adding the row updates it.

  var displayName = name || '(no name)';
  var displayNeed = need || '(no need)';
  var welcomeNote = '';
  if (isDup) welcomeNote = 'DUPLICATE — this intake was already in the log, so no new row was written and no welcome was sent.';
  else if (missing.length) welcomeNote = 'MISSING FIELD (' + missing.join(', ') + ') — welcome not sent.';

  // Bug 4 (M02, stabilization patch): send failures are tracked, not
  // swallowed. Each send has its own try/catch so an alert failure cannot
  // kill the welcome and vice versa, but a failure is APPENDED to J (never
  // overwriting a hand note) and the handler rethrows at the end so the
  // failure is visible instead of only in Logger.
  var alertFailed = null;
  var welcomeFailed = null;

  // Alert to Bryan (always attempted). See QA-M02, QA-m05.
  try {
    GmailApp.sendEmail(ALERT_TO,
      'New client intake: ' + displayName + ' — ' + displayNeed,
      'New intake on the Client Onboarding form.\n\n' +
      'Name: ' + name + '\n' +
      'Company: ' + company + '\n' +
      'Email: ' + email + '\n' +
      'What they need: ' + need + '\n' +
      'Start date: ' + (startDate || '') + '\n' +
      'Received: ' + timestamp + '\n\n' +
      'Log: ' + SHEET_URL + '\n' +
      'Status is New until you contact them. Reply within one business day.' +
      (welcomeNote ? '\n\n' + welcomeNote : ''));
  } catch (err) {
    alertFailed = err.message;
    Logger.log('Alert send failed: ' + err.message);
  }

  // Welcome to the client (only with a valid email, a non-blank name, and a
  // non-duplicate row). A blank name means no welcome goes out (Claude Bug 3).
  if (!isDup && emailOk && name) {
    try {
      GmailApp.sendEmail(email,
        "Thanks — I'll reply within one business day",
        'Hi ' + name + ',\n\n' +
        'Thanks for reaching out about ' + (need || 'your inquiry') + ". I've got your note and I'll reply within one business day.\n\n" +
        'If anything changes before then, just reply to this email.\n\n' +
        'Bryan Francis\n' +
        'BFrancis360\n' +
        'Bfrancis360AI@gmail.com');
    } catch (err) {
      welcomeFailed = err.message;
      Logger.log('Welcome send failed: ' + err.message);
    }
  }

  // Append any failure flags to J (never overwrite a hand note or the
  // close-out note). A missing-field flag is appended the same way.
  if (row > 0 && !isDup) {
    var flags = [];
    if (alertFailed) flags.push('ALERT FAILED: ' + alertFailed);
    if (welcomeFailed) flags.push('WELCOME FAILED: ' + welcomeFailed);
    if (missing.length) flags.push('MISSING FIELD (' + missing.join(', ') + ') — welcome not sent.');
    if (flags.length) {
      var cur = String(sheet.getRange(row, 10).getValue() || '');
      var updated = cur ? cur + '\n' + flags.join('\n') : flags.join('\n');
      sheet.getRange(row, 10).setValue(updated);
    }
  }

  // Rethrow so a send failure is visible (the execution is marked failed)
  // instead of only in Logger. The row is already logged, so nothing is lost.
  if (alertFailed || welcomeFailed) {
    throw new Error('Client Onboarding send failed: ' +
      (alertFailed ? 'alert (' + alertFailed + ')' : '') +
      (alertFailed && welcomeFailed ? '; ' : '') +
      (welcomeFailed ? 'welcome (' + welcomeFailed + ')' : ''));
  }
}

function namedValuesMap(e) {
  // e.namedValues keys are the exact question titles. Keep a lookup that
  // also tolerates the title prefix, so a wording tweak does not break it.
  // Prefix tolerance covers all five titles. See QA-m02.
  var TITLES = ['Name', 'Company', 'Email', 'What they need', 'Start date'];
  var out = {};
  var nv = e.namedValues || {};
  Object.keys(nv).forEach(function (k) {
    out[k] = nv[k];
    TITLES.forEach(function (t) {
      if (k.indexOf(t) === 0) out[t] = nv[k];
    });
  });
  // Fallback (added 2026-11-24): the first live trigger run arrived with
  // e.namedValues empty, so every field read blank and the thank-you email
  // failed with "no recipient". The response object itself always carries
  // the answers, so fill any missing title from it. When namedValues is
  // present this changes nothing.
  if (e.response && e.response.getItemResponses) {
    e.response.getItemResponses().forEach(function (ir) {
      var title = ir.getItem().getTitle();
      var cur = out[title];
      if (!cur || !cur.length || !cur[0]) {
        out[title] = [responseValueString(ir.getResponse())];
      }
    });
    Object.keys(out).forEach(function (k) {
      TITLES.forEach(function (t) {
        if (k.indexOf(t) === 0 && (!out[t] || !out[t][0])) out[t] = out[k];
      });
    });
  }
  return out;
}

function responseValueString(v) {
  // ItemResponse.getResponse() is a string for text/choice answers, but a
  // Date object for date answers. Normalise to the 'yyyy-mm-dd' string the
  // rest of the script expects, in America/New_York.
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return formatDateET(v);
  }
  return String(v);
}

function firstValue(map, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = map[keys[i]];
    if (v && v.length) return v[0];
  }
  return '';
}

function parseFormDate(s) {
  // Forms date answers arrive as 'yyyy-mm-dd'. Return a Date at local
  // midnight, or '' when blank or invalid, so the Sheet stores a real date.
  // Validates month/day and round-trips the constructed date. See QA-m01.
  if (!s) return '';
  var p = String(s).split('-');
  if (p.length !== 3) return '';
  var y = +p[0], m = +p[1], d = +p[2];
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return '';
  var dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
  return dt;
}

// Step 2 — Contacted auto-stamp (installable onEdit trigger on the Sheet).
// When a row's Status is changed to Contacted and Contacted on is empty,
// stamp Contacted on as today and set Follow-up date 2 business days out
// (leaving a hand-entered Follow-up date alone). When Status is changed
// back to New, clear Contacted on and Follow-up date and keep Notes as the
// preserved record. Re-contacting a row clears a stale machine close-out
// note but keeps hand-written notes.
// Loop guard: the handler returns unless the edited range includes the
// Status column (G), so its own writes to H/I/J never re-trigger it.
// The Contacted-on condition is the idempotency guard: re-touching Status
// does not re-stamp. See QA-M01, QA-M04, QA-M05, QA-M06, QA-M07, QA-m13.
function onStatusChange(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== LOG_TAB) return;
  checkTimezone_();
  // NEW-03: the two status handlers share a script lock, so a quick
  // Contacted→Onboarded flip cannot let a delayed Step 2 write land after
  // Step 3 cleared H. waitLock blocks (up to 10s) instead of returning,
  // so no status change is silently dropped.
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (err) {
    Logger.log('onStatusChange: could not get the script lock; status change not processed.');
    return;
  }
  try {
  var rows = editedStatusRows_(e);
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i].row;
    if (row < 2) continue;
    var status = normalizeStatus_(rows[i].status);
    // Write the canonical status back to G when the cell holds a
    // case/whitespace variant (Claude M04), so K and the Dashboard COUNTIFs
    // see it. Programmatic writes do not re-fire onEdit.
    if (status && String(rows[i].status) !== status) {
      sheet.getRange(row, 7).setValue(status);
    }
    if (status === 'New') {
      // Revert (QA-M07): clear the contact fields (H, I); Notes stays as a
      // preserved record, with the machine close-out note marked so a later
      // Onboarded writes a fresh note instead of keeping the stale date.
      // Skip the wipe when the cell was already New (a re-select, not a
      // revert). e.oldValue is only set for single-cell edits (Claude M07).
      var isSingleCell = (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1);
      if (isSingleCell && e.oldValue !== undefined && normalizeStatus_(e.oldValue) === 'New') {
        continue;
      }
      var notes = sheet.getRange(row, 10).getValue();
      var marked = markCloseOutNotePreserved_(notes);
      sheet.getRange(row, 8, 1, 3).setValues([['', '', marked]]);
      continue;
    }
    if (status !== 'Contacted') continue;
    // Re-contact (Claude Bug 1): if J carries a machine close-out note, this
    // row was Onboarded before. Strip the note and clear Contacted on so the
    // row re-stamps fresh. Without this, the I guard below returns and the
    // row reads Contacted with no follow-up and a stale note.
    var j0 = sheet.getRange(row, 10).getValue();
    if (hasCloseOutNote_(j0)) {
      sheet.getRange(row, 10).setValue(stripCloseOutNote_(j0));
      sheet.getRange(row, 9).setValue('');
    }
    // M01 (stabilization patch): validate H and I independently. A
    // Contacted row with I filled and H blank never got a follow-up (it
    // happened if someone deleted the machine note or hand-stamped I).
    // Fill whichever is missing; the follow-up is 2 business days after
    // the contacted date, not after today.
    var contactedOn = parseSheetDate_(sheet.getRange(row, 9).getValue());
    var followUp = parseSheetDate_(sheet.getRange(row, 8).getValue());
    if (contactedOn && followUp) continue; // already stamped
    var today = todayET();
    var newContacted = contactedOn || today;
    var newFollowUp = followUp || addBusinessDays(newContacted, 2);
    // One write for H:I (QA-m04).
    sheet.getRange(row, 8, 1, 2).setValues([[newFollowUp, newContacted]]);
  }
  } finally {
    lock.releaseLock();
  }
}

function addBusinessDays(date, n) {
  // Correct per QA verification (Fri +2 = Tue, Thu +2 = Mon, Sat/Sun +2 =
  // Tue, Mon +2 = Wed, DST spring-forward clean). Relies on the project
  // timezone being America/New_York (QA-M09).
  var d = new Date(date.getTime());
  var added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    var day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

// Step 3 — Onboarded close-out (its own installable onEdit trigger on the Sheet).
// When a row's Status is changed to Onboarded and Notes / Close-out does not
// already carry the machine close-out note, write (or append) the close-out
// note and clear Follow-up date. A hand-written note in Notes does not block
// the close-out; the note is appended after it. See QA-B1.
// Loop guard: the handler returns unless the edited range includes the
// Status column (G). The machine-note check is the idempotency guard.
function onOnboarded(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== LOG_TAB) return;
  checkTimezone_();
  // NEW-03: shared script lock with onStatusChange (see there).
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (err) {
    Logger.log('onOnboarded: could not get the script lock; status change not processed.');
    return;
  }
  try {
  var rows = editedStatusRows_(e);
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i].row;
    if (row < 2) continue;
    var status = normalizeStatus_(rows[i].status);
    // Write the canonical status back to G when the cell holds a
    // case/whitespace variant (Claude M04), so K and the Dashboard COUNTIFs
    // see it. Programmatic writes do not re-fire onEdit.
    if (status && String(rows[i].status) !== status) {
      sheet.getRange(row, 7).setValue(status);
    }
    if (status !== 'Onboarded') continue;
    var existing = String(sheet.getRange(row, 10).getValue() || '');
    var contactedOn = sheet.getRange(row, 9).getValue();
    if (hasCloseOutNote_(existing)) {
      // Already closed out: still clear the follow-up date (Claude Bug 2).
      sheet.getRange(row, 8).setValue('');
      continue;
    }
    var today = todayET();
    var note = 'Onboarded ' + formatDateET(today) + ' — welcome complete; no further follow-up.';
    var newNotes = existing ? existing + '\n' + note : note;
    // One write for H:J, preserving Contacted on (I). See QA-m04.
    sheet.getRange(row, 8, 1, 3).setValues([['', contactedOn, newNotes]]);
  }
  } finally {
    lock.releaseLock();
  }
}

// Step 4 — Overdue digest (time-driven trigger, weekdays 9:00 AM ET).
// Sends a digest email to Bryan listing New rows more than one business day
// old. Sends ONLY when at least one overdue row exists.
function sendOverdueDigest() {
  checkTimezone_();
  var today = todayET();
  // Weekday guard (QA-m03): the trigger is Mon–Fri, but the code defends it.
  if (today.getDay() === 0 || today.getDay() === 6) return;
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(LOG_TAB);
  if (!sheet) {
    Logger.log('sendOverdueDigest: "' + LOG_TAB + '" tab not found.');
    // NEW-06: surface it by email, not just the log, so a missing tab is
    // not silently skipped.
    try {
      GmailApp.sendEmail(ALERT_TO, 'Client Onboarding: Intake Log tab missing (digest)',
        'The overdue digest ran but the "' + LOG_TAB + '" tab was not found in the Sheet, so no overdue intakes were checked.\n\nLog: ' + SHEET_URL);
    } catch (err) { Logger.log('Digest missing-tab alert failed: ' + err.message); }
    return;
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var rows = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var overdue = [];
  for (var i = 0; i < rows.length; i++) {
    var ts = parseSheetDate_(rows[i][0]); // Timestamp (A), ET calendar date (M08)
    var status = normalizeStatus_(rows[i][6]); // Status (G), QA-M04
    if (status !== 'New') continue;
    // Skip only if the Timestamp is still unparseable, and log the row.
    if (!ts) {
      Logger.log('sendOverdueDigest: row ' + (i + 2) + ' skipped, unparseable Timestamp.');
      continue;
    }
    if (today.getTime() > addBusinessDays(ts, 1).getTime()) {
      overdue.push({
        name: rows[i][1],
        need: rows[i][4],
        received: ts,
        waiting: businessDaysWaiting(ts, today)
      });
    }
  }
  if (overdue.length === 0) return;
  var lines = [];
  for (var j = 0; j < overdue.length; j++) {
    var o = overdue[j];
    lines.push(o.name + ' — ' + o.need + ' — received ' + formatDateET(o.received) + ' — ' + o.waiting + ' business day' + (o.waiting === 1 ? '' : 's') + ' waiting');
  }
  var body = 'Overdue intakes — New for more than one business day.\n\n' + lines.join('\n') + '\n\nDashboard: ' + SHEET_URL + '\n';
  GmailApp.sendEmail(ALERT_TO, 'Overdue intakes: ' + overdue.length + ' New over 1 business day', body);
}

function businessDaysWaiting(start, end) {
  // Whole business days from the day after start to end (inclusive).
  // Correct per spec §6.1 and QA verification (Sat → Mon = 1). Relies on
  // the project timezone being America/New_York (QA-M09).
  var d = new Date(start.getTime());
  d.setHours(0, 0, 0, 0);
  var count = 0;
  while (d.getTime() < end.getTime()) {
    d.setDate(d.getDate() + 1);
    var day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}
