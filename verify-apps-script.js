// verify-apps-script.js — Node test for the Apps Script (Steps 1–4).
// Stubs the Apps Script globals, loads apps-script/Code.gs, and drives the
// handlers with mock events. Run: node verify-apps-script.js
// Covers the QA fixes and the Claude second-opinion patch (Bugs 1–3).
// No live Sheet, Form, or email is touched.

const fs = require('fs');
const path = require('path');

// ---------- Mock Sheet ----------
const LOG = [];
// Row 1 = header. Row 2 = a test intake (Darius-like).
LOG[0] = ['Timestamp', 'Name', 'Company', 'Email', 'What they need', 'Start date', 'Status', 'Follow-up date', 'Contacted on', 'Notes / Close-out', 'SLA flag'];

function makeRow(ts, name, company, email, need, start, status, h, i, j, k) {
  return [ts, name, company, email, need, start, status, h, i, j, k];
}

function mockRange(sheet, r, c, numRows, numCols) {
  numRows = numRows || 1;
  numCols = numCols || 1;
  return {
    getRow: () => r,
    getLastRow: () => r + numRows - 1,
    getColumn: () => c,
    getLastColumn: () => c + numCols - 1,
    getNumRows: () => numRows,
    getNumColumns: () => numCols,
    getSheet: () => sheet,
    getValue: () => sheet.rows[r - 1][c - 1],
    getValues: () => {
      const out = [];
      for (let i = 0; i < numRows; i++) {
        out.push(sheet.rows[r - 1 + i].slice(c - 1, c - 1 + numCols));
      }
      return out;
    },
    setValue: (v) => {
      if (!sheet.rows[r - 1]) sheet.rows[r - 1] = new Array(11).fill('');
      sheet.rows[r - 1][c - 1] = v;
    },
    setValues: (vals) => {
      for (let i = 0; i < vals.length; i++) {
        if (!sheet.rows[r - 1 + i]) sheet.rows[r - 1 + i] = new Array(11).fill('');
        for (let j = 0; j < vals[i].length; j++) {
          sheet.rows[r - 1 + i][c - 1 + j] = vals[i][j];
        }
      }
    },
    setFormula: (f) => { sheet.rows[r - 1][c - 1] = f; },
  };
}

const mockSheet = {
  name: 'Intake Log',
  rows: LOG,
  getName() { return this.name; },
  getLastRow() {
    // Last row with any non-empty cell (mirrors the real getLastRow closely
    // enough for these tests; rows are never deleted here).
    let last = 1;
    for (let i = 0; i < this.rows.length; i++) {
      if (this.rows[i] && this.rows[i].some((v) => v !== '' && v !== undefined && v !== null)) last = i + 1;
    }
    return last;
  },
  getRange(r, c, numRows, numCols) { return mockRange(this, r, c, numRows, numCols); },
};

// ---------- Mock Apps Script services ----------
const sentEmails = [];
const logs = [];

function fmtET(d) {
  // Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function fmtETDateTime(d) {
  // Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd HH:mm:ss')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

global.SpreadsheetApp = {
  openById() { return { getSheetByName: (n) => (n === 'Intake Log' ? mockSheet : null) }; },
  flush() {},
};
let gmailFailFor = null; // set to a recipient to make GmailApp.sendEmail throw for it
global.GmailApp = {
  sendEmail(to, subject, body) {
    if (gmailFailFor && to === gmailFailFor) throw new Error('simulated send failure');
    sentEmails.push({ to, subject, body });
  },
};
global.LockService = {
  getScriptLock() { return { tryLock: () => true, waitLock: () => true, releaseLock: () => {} }; },
};
const scriptProps = {};
global.PropertiesService = {
  getScriptProperties() {
    return {
      getProperty: (k) => (k in scriptProps ? scriptProps[k] : null),
      setProperty: (k, v) => { scriptProps[k] = v; },
    };
  },
};
global.Logger = { log: (m) => logs.push(String(m)) };
global.Session = { getScriptTimeZone: () => 'America/New_York' };
global.Utilities = {
  formatDate: (d, tz, fmt) => (fmt === 'yyyy-MM-dd HH:mm:ss' ? fmtETDateTime(d) : fmtET(d)),
};

// ---------- Load Code.gs ----------
const code = fs.readFileSync(path.join(__dirname, 'apps-script', 'Code.gs'), 'utf8');
// Strip the top comment block is unnecessary; eval the whole file.
eval(code);

// ---------- Helpers ----------
let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (extra ? ' — ' + extra : '')); }
}
function fmt(d) { return d instanceof Date ? fmtET(d) : String(d); }
function cell(r, c) { return mockSheet.rows[r - 1][c - 1]; }
function setStatus(row, value, oldValue) {
  // Drive the onEdit handlers the way the Sheet would: set G, then fire both.
  mockSheet.rows[row - 1][6] = value;
  const e = {
    range: mockRange(mockSheet, row, 7, 1, 1),
    oldValue,
  };
  onStatusChange(e);
  onOnboarded(e);
}
function resetRow2() {
  // Fresh Contacted-ready row: New, no H/I/J.
  mockSheet.rows[1] = makeRow(new Date(2026, 10, 24, 10, 0), 'Test Client', 'Test Co', 'test@example.com', 'Workflow audit', new Date(2026, 10, 25), 'New', '', '', '', '');
}

// ---------- Tests ----------
// T1: M01 — Contacted with a hand-filled Follow-up date still stamps I.
resetRow2();
mockSheet.rows[1][7] = new Date(2026, 10, 27); // hand-filled H
setStatus(2, 'Contacted', 'New');
check('M01 hand-filled H still stamps I', cell(2, 9) instanceof Date, 'I=' + fmt(cell(2, 9)));
check('M01 hand-filled H is left alone', fmt(cell(2, 8)) === '2026-11-27', 'H=' + fmt(cell(2, 8)));

// T2: Step 2 normal — Contacted stamps I=today and H=+2 business days.
resetRow2();
setStatus(2, 'Contacted', 'New');
check('Step 2 stamps I', cell(2, 9) instanceof Date, 'I=' + fmt(cell(2, 9)));
check('Step 2 H is +2 business days', fmt(cell(2, 8)) === '2026-11-26', 'H=' + fmt(cell(2, 8)));

// T3: B1 — Onboarded with a hand note appends the close-out note.
resetRow2();
setStatus(2, 'Contacted', 'New');
mockSheet.rows[1][9] = 'called, left voicemail';
setStatus(2, 'Onboarded', 'Contacted');
check('B1 hand note preserved', String(cell(2, 10)).indexOf('called, left voicemail') === 0, 'J=' + cell(2, 10));
check('B1 close-out note appended', String(cell(2, 10)).indexOf('Onboarded 20') !== -1, 'J=' + cell(2, 10));
check('B1 H cleared on Onboarded', cell(2, 8) === '', 'H=' + fmt(cell(2, 8)));

// T4: Bug 1 (Claude) — Onboarded → Contacted re-stamps H and I, strips note.
resetRow2();
setStatus(2, 'Contacted', 'New');
const firstI = fmt(cell(2, 9));
const firstH = fmt(cell(2, 8));
setStatus(2, 'Onboarded', 'Contacted');
check('Bug1 setup: Onboarded writes note', String(cell(2, 10)).indexOf('Onboarded ') === 0, 'J=' + cell(2, 10));
check('Bug1 setup: Onboarded clears H', cell(2, 8) === '', 'H=' + fmt(cell(2, 8)));
check('Bug1 setup: Onboarded keeps I', fmt(cell(2, 9)) === firstI, 'I=' + fmt(cell(2, 9)));
setStatus(2, 'Contacted', 'Onboarded');
check('Bug1 re-contact re-stamps H', cell(2, 8) instanceof Date && fmt(cell(2, 8)) !== '', 'H=' + fmt(cell(2, 8)));
check('Bug1 re-contact keeps I', fmt(cell(2, 9)) === firstI, 'I=' + fmt(cell(2, 9)));
check('Bug1 re-contact strips stale note', String(cell(2, 10)) === '', 'J=' + cell(2, 10));

// T5: Bug 2 (Claude) — Onboarded on a row that already has a note clears H.
resetRow2();
setStatus(2, 'Contacted', 'New');
setStatus(2, 'Onboarded', 'Contacted');
mockSheet.rows[1][7] = new Date(2026, 10, 30); // H reappears (hand edit)
setStatus(2, 'Onboarded', 'Onboarded'); // re-touch Onboarded
check('Bug2 re-Onboarded clears H', cell(2, 8) === '', 'H=' + fmt(cell(2, 8)));
check('Bug2 note not duplicated', (String(cell(2, 10)).match(/Onboarded \d{4}-\d{2}-\d{2}/g) || []).length === 1, 'J=' + cell(2, 10));

// T6: M07 chain — Onboarded → New → Contacted → Onboarded writes a fresh note.
resetRow2();
setStatus(2, 'Contacted', 'New');
setStatus(2, 'Onboarded', 'Contacted');
const firstNote = String(cell(2, 10));
setStatus(2, 'New', 'Onboarded');
check('M07 revert clears I', cell(2, 9) === '', 'I=' + fmt(cell(2, 9)));
check('M07 revert clears H', cell(2, 8) === '', 'H=' + fmt(cell(2, 8)));
check('M07 revert marks note preserved', String(cell(2, 10)).indexOf('Previous onboarding') === 0, 'J=' + cell(2, 10));
setStatus(2, 'Contacted', 'New');
check('M07 re-contact stamps I again', cell(2, 9) instanceof Date, 'I=' + fmt(cell(2, 9)));
setStatus(2, 'Onboarded', 'Contacted');
check('M07 second Onboarded writes fresh note', (String(cell(2, 10)).match(/Onboarded \d{4}-\d{2}-\d{2}/g) || []).length === 1 && String(cell(2, 10)).indexOf('Previous onboarding') === 0, 'J=' + cell(2, 10));

// T7: M07 re-select guard — re-selecting New does not wipe H/I.
// (Single-cell edit with oldValue already New.)
resetRow2();
setStatus(2, 'Contacted', 'New');
const keepH = cell(2, 8), keepI = cell(2, 9);
// Simulate a re-select of New on a row that is already New (H/I blank here,
// so use a Contacted row reverted first, then re-select New).
setStatus(2, 'New', 'Contacted'); // real revert: clears H/I
mockSheet.rows[1][7] = new Date(2026, 10, 27); // hand-entered H on the New row
mockSheet.rows[1][8] = new Date(2026, 10, 24); // hand-entered I on the New row
setStatus(2, 'New', 'New'); // re-select New (oldValue New)
check('M07 re-select New keeps hand H/I', fmt(cell(2, 8)) === '2026-11-27' && fmt(cell(2, 9)) === '2026-11-24', 'H=' + fmt(cell(2, 8)) + ' I=' + fmt(cell(2, 9)));

// T8: Bug 3 (Claude) — blank name + valid email sends NO welcome.
resetRow2();
sentEmails.length = 0;
const fakeResponse = {
  getTimestamp: () => new Date(2026, 10, 24, 12, 0),
  getItemResponses: () => [
    { getItem: () => ({ getTitle: () => 'Name' }), getResponse: () => '' },
    { getItem: () => ({ getTitle: () => 'Company' }), getResponse: () => 'Test Co' },
    { getItem: () => ({ getTitle: () => 'Email' }), getResponse: () => 'test@example.com' },
    { getItem: () => ({ getTitle: () => 'What they need' }), getResponse: () => 'Workflow audit' },
    { getItem: () => ({ getTitle: () => 'Start date' }), getResponse: () => '' },
  ],
};
const eBlankName = { response: fakeResponse, namedValues: { Name: [''], Company: ['Test Co'], Email: ['test@example.com'], 'What they need': ['Workflow audit'], 'Start date': [''] } };
onIntakeSubmit(eBlankName);
const welcomes = sentEmails.filter((m) => m.to === 'test@example.com');
check('Bug3 blank name sends no welcome', welcomes.length === 0, 'welcomes=' + welcomes.length);
const alerts = sentEmails.filter((m) => m.to === 'Bfrancis360AI@gmail.com');
check('Bug3 alert still goes out', alerts.length === 1, 'alerts=' + alerts.length);
check('Bug3 alert flags MISSING FIELD', alerts.length === 1 && alerts[0].body.indexOf('MISSING FIELD') !== -1, '');
// The row was appended; its J should carry the MISSING FIELD flag.
const newRow = mockSheet.getLastRow();
check('Bug3 J flags MISSING FIELD', String(cell(newRow, 10)).indexOf('MISSING FIELD') === 0, 'J=' + cell(newRow, 10));

// T9: Normal submit — row + alert + welcome.
sentEmails.length = 0;
const before = mockSheet.getLastRow();
const fakeResponse2 = {
  getTimestamp: () => new Date(2026, 10, 24, 13, 0),
  getItemResponses: () => [
    { getItem: () => ({ getTitle: () => 'Name' }), getResponse: () => 'Jordan Example' },
    { getItem: () => ({ getTitle: () => 'Company' }), getResponse: () => 'Example Ops' },
    { getItem: () => ({ getTitle: () => 'Email' }), getResponse: () => 'jordan@example.com' },
    { getItem: () => ({ getTitle: () => 'What they need' }), getResponse: () => 'RevOps setup' },
    { getItem: () => ({ getTitle: () => 'Start date' }), getResponse: () => '' },
  ],
};
const eNormal = { response: fakeResponse2, namedValues: { Name: ['Jordan Example'], Company: ['Example Ops'], Email: ['jordan@example.com'], 'What they need': ['RevOps setup'], 'Start date': [''] } };
onIntakeSubmit(eNormal);
check('Normal submit appends a row', mockSheet.getLastRow() === before + 1, 'rows=' + mockSheet.getLastRow());
check('Normal submit sends alert + welcome', sentEmails.length === 2, 'sent=' + sentEmails.length);
check('Normal submit welcome greets by name', sentEmails.some((m) => m.to === 'jordan@example.com' && m.body.indexOf('Hi Jordan Example') === 0), '');

// T11: NEW-01 — a client value starting with '=' is stored as literal text.
sentEmails.length = 0;
const beforeInj = mockSheet.getLastRow();
const fakeInj = {
  getTimestamp: () => new Date(2026, 10, 24, 14, 0),
  getItemResponses: () => [
    { getItem: () => ({ getTitle: () => 'Name' }), getResponse: () => '=IMPORTXML("http://x","//a")' },
    { getItem: () => ({ getTitle: () => 'Company' }), getResponse: () => 'Test Co' },
    { getItem: () => ({ getTitle: () => 'Email' }), getResponse: () => 'inj@example.com' },
    { getItem: () => ({ getTitle: () => 'What they need' }), getResponse: () => 'Automation build' },
    { getItem: () => ({ getTitle: () => 'Start date' }), getResponse: () => '' },
  ],
};
const eInj = { response: fakeInj, namedValues: { Name: ['=IMPORTXML("http://x","//a")'], Company: ['Test Co'], Email: ['inj@example.com'], 'What they need': ['Automation build'], 'Start date': [''] } };
onIntakeSubmit(eInj);
const injRow = mockSheet.getLastRow();
check('NEW-01 formula value stored as text', String(cell(injRow, 2)).indexOf("'=") === 0, 'B=' + cell(injRow, 2));
check('NEW-01 normal name not prefixed', String(cell(injRow, 3)) === 'Test Co', 'C=' + cell(injRow, 3));

// T12: M08 — parseSheetDate_ reads a date-only string and a serial as the ET date.
const dStr = parseSheetDate_('2026-11-23');
check('M08 date-only string is 2026-11-23', dStr instanceof Date && fmtET(dStr) === '2026-11-23', 'got=' + (dStr ? fmtET(dStr) : dStr));
// Serial for 2026-11-23: days since 1899-12-30. 2025-01-01 is 45658;
// 2025-01-01 to 2026-11-23 is 365 + 326 = 691 days, so 45658 + 691 = 46349.
const dSer = parseSheetDate_(46349);
check('M08 serial 46349 is 2026-11-23', dSer instanceof Date && fmtET(dSer) === '2026-11-23', 'got=' + (dSer ? fmtET(dSer) : dSer));
check('M08 blank returns null', parseSheetDate_('') === null, '');
check('M08 garbage returns null', parseSheetDate_('not-a-date') === null, '');

// T13: Bug 4 — welcome send failure appends to J (keeps a hand note) and rethrows.
resetRow2();
mockSheet.rows[1][9] = 'called, left voicemail'; // hand note in J
sentEmails.length = 0;
gmailFailFor = 'test@example.com'; // the welcome recipient
const fakeFail = {
  getTimestamp: () => new Date(2026, 10, 24, 15, 0),
  getItemResponses: () => [
    { getItem: () => ({ getTitle: () => 'Name' }), getResponse: () => 'Fail Client' },
    { getItem: () => ({ getTitle: () => 'Company' }), getResponse: () => 'Test Co' },
    { getItem: () => ({ getTitle: () => 'Email' }), getResponse: () => 'test@example.com' },
    { getItem: () => ({ getTitle: () => 'What they need' }), getResponse: () => 'Workflow audit' },
    { getItem: () => ({ getTitle: () => 'Start date' }), getResponse: () => '' },
  ],
};
const eFail = { response: fakeFail, namedValues: { Name: ['Fail Client'], Company: ['Test Co'], Email: ['test@example.com'], 'What they need': ['Workflow audit'], 'Start date': [''] } };
let threw = false;
try { onIntakeSubmit(eFail); } catch (err) { threw = true; }
gmailFailFor = null;
const failRow = mockSheet.getLastRow();
check('Bug4 welcome failure rethrows', threw, '');
check('Bug4 welcome failure appended to J', String(cell(failRow, 10)).indexOf('WELCOME FAILED') !== -1, 'J=' + cell(failRow, 10));
check('Bug4 alert still sent on welcome failure', sentEmails.some((m) => m.to === 'Bfrancis360AI@gmail.com'), '');

// T14: Bug 4 — alert send failure appends to J and rethrows.
sentEmails.length = 0;
gmailFailFor = 'Bfrancis360AI@gmail.com'; // the alert recipient
const fakeFail2 = {
  getTimestamp: () => new Date(2026, 10, 24, 16, 0),
  getItemResponses: () => [
    { getItem: () => ({ getTitle: () => 'Name' }), getResponse: () => 'Alert Fail' },
    { getItem: () => ({ getTitle: () => 'Company' }), getResponse: () => 'Test Co' },
    { getItem: () => ({ getTitle: () => 'Email' }), getResponse: () => 'alertfail@example.com' },
    { getItem: () => ({ getTitle: () => 'What they need' }), getResponse: () => 'RevOps setup' },
    { getItem: () => ({ getTitle: () => 'Start date' }), getResponse: () => '' },
  ],
};
const eFail2 = { response: fakeFail2, namedValues: { Name: ['Alert Fail'], Company: ['Test Co'], Email: ['alertfail@example.com'], 'What they need': ['RevOps setup'], 'Start date': [''] } };
let threw2 = false;
try { onIntakeSubmit(eFail2); } catch (err) { threw2 = true; }
gmailFailFor = null;
const failRow2 = mockSheet.getLastRow();
check('Bug4 alert failure rethrows', threw2, '');
check('Bug4 alert failure appended to J', String(cell(failRow2, 10)).indexOf('ALERT FAILED') !== -1, 'J=' + cell(failRow2, 10));

// T15: NEW-04 — a bulk edit over a blank row does not stamp it.
resetRow2();
// Row 3 is blank (no Timestamp). Set G2:G3 to Contacted in one edit.
mockSheet.rows[1][6] = 'Contacted';
mockSheet.rows[2] = new Array(11).fill(''); // blank row 3
const eBulk = { range: mockRange(mockSheet, 2, 7, 2, 1), oldValue: undefined };
onStatusChange(eBulk);
onOnboarded(eBulk);
check('NEW-04 blank row not stamped', cell(3, 9) === '' && cell(3, 8) === '', 'H=' + fmt(cell(3, 8)) + ' I=' + fmt(cell(3, 9)));
check('NEW-04 real row still stamped', cell(2, 9) instanceof Date, 'I=' + fmt(cell(2, 9)));

// T16: m07 — the per-row SLA formula uses a nested IF, not AND(ISNUMBER...).
const kFormula = String(cell(injRow, 11));
check('m07 SLA formula uses nested IF', kFormula.indexOf('=IF(ISNUMBER(A') === 0, 'K=' + kFormula);

// T17: Dedup 1-second tolerance — a re-run 500ms later is a duplicate; 5s later is not.
sentEmails.length = 0;
const beforeTol = mockSheet.getLastRow();
const baseTs = new Date(2026, 10, 24, 17, 0, 0, 0);
function tolResponse(ts) {
  return {
    getTimestamp: () => ts,
    getItemResponses: () => [
      { getItem: () => ({ getTitle: () => 'Name' }), getResponse: () => 'Tol Client' },
      { getItem: () => ({ getTitle: () => 'Company' }), getResponse: () => 'Test Co' },
      { getItem: () => ({ getTitle: () => 'Email' }), getResponse: () => 'tol@example.com' },
      { getItem: () => ({ getTitle: () => 'What they need' }), getResponse: () => 'Automation build' },
      { getItem: () => ({ getTitle: () => 'Start date' }), getResponse: () => '' },
    ],
  };
}
const eTol1 = { response: tolResponse(baseTs), namedValues: { Name: ['Tol Client'], Company: ['Test Co'], Email: ['tol@example.com'], 'What they need': ['Automation build'], 'Start date': [''] } };
onIntakeSubmit(eTol1);
check('Tol first submit appends', mockSheet.getLastRow() === beforeTol + 1, 'rows=' + mockSheet.getLastRow());
const eTol2 = { response: tolResponse(new Date(baseTs.getTime() + 500)), namedValues: { Name: ['Tol Client'], Company: ['Test Co'], Email: ['tol@example.com'], 'What they need': ['Automation build'], 'Start date': [''] } };
onIntakeSubmit(eTol2);
check('Tol re-run +500ms is a duplicate', mockSheet.getLastRow() === beforeTol + 1, 'rows=' + mockSheet.getLastRow());
const eTol3 = { response: tolResponse(new Date(baseTs.getTime() + 5000)), namedValues: { Name: ['Tol Client'], Company: ['Test Co'], Email: ['tol@example.com'], 'What they need': ['Automation build'], 'Start date': [''] } };
onIntakeSubmit(eTol3);
check('Tol submit +5s is a new row', mockSheet.getLastRow() === beforeTol + 2, 'rows=' + mockSheet.getLastRow());

// T18: B1 — a hand note starting "Onboarded yyyy-mm-dd —" does NOT match the machine note.
resetRow2();
setStatus(2, 'Contacted', 'New');
mockSheet.rows[1][9] = 'Onboarded 2026-11-20 — called'; // hand note, same prefix
setStatus(2, 'Onboarded', 'Contacted');
check('B1 hand note with Onboarded prefix does not block close-out', String(cell(2, 10)).indexOf('welcome complete; no further follow-up.') !== -1, 'J=' + cell(2, 10));
check('B1 hand note kept alongside close-out', String(cell(2, 10)).indexOf('Onboarded 2026-11-20 — called') === 0, 'J=' + cell(2, 10));

// T19: M01 — a Contacted row with I filled and H blank gets its follow-up filled.
resetRow2();
mockSheet.rows[1][6] = 'Contacted';
mockSheet.rows[1][8] = new Date(2026, 10, 24); // I filled (Tue 11/24)
mockSheet.rows[1][7] = ''; // H blank
const eM01 = { range: mockRange(mockSheet, 2, 7, 1, 1), oldValue: 'New' };
onStatusChange(eM01);
onOnboarded(eM01);
check('M01 I-filled H-blank gets follow-up', fmt(cell(2, 8)) === '2026-11-26', 'H=' + fmt(cell(2, 8)));
check('M01 I kept', fmt(cell(2, 9)) === '2026-11-24', 'I=' + fmt(cell(2, 9)));

// T20: Timestamp ET normalization — an 8:09 PM ET submit stores as 20:09 ET, not 01:09 UTC next day.
const utcTs = new Date('2026-11-25T01:09:00Z'); // 8:09 PM ET on 11/24
const etTs = toETDate_(utcTs);
check('ET timestamp is 2026-11-24 20:09', fmtETDateTime(etTs) === '2026-11-24 20:09:00', 'got=' + fmtETDateTime(etTs));

// T21: NEW-09 — the timezone alert fires at most once per day.
sentEmails.length = 0;
global.Session.getScriptTimeZone = () => 'America/Chicago'; // wrong timezone
delete scriptProps.tzAlertDate;
checkTimezone_();
checkTimezone_();
const tzAlerts = sentEmails.filter((m) => m.subject.indexOf('script timezone is wrong') !== -1);
check('NEW-09 timezone alert sent once per day', tzAlerts.length === 1, 'alerts=' + tzAlerts.length);
global.Session.getScriptTimeZone = () => 'America/New_York'; // restore

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
