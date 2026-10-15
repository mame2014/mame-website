/**
 * MAME Capital — website enquiries → Google Sheet + auto-reply + notification.
 *
 * Runs as a Google Apps Script web app bound to the "MAME Leads" spreadsheet,
 * owned by rene.prince@mamecapital.com. Both emails go out from the info@ alias
 * (Gmail → Settings → Accounts → "Send mail as" must list it).
 * The website (functions/api/contact.js) POSTs each enquiry as JSON to:
 *   <web app URL>?key=<WEBHOOK_KEY>
 *
 * Setup: see docs/automation/apps-script/README.md
 */

const SHEET_NAME = 'Leads';
const NOTIFY_EMAIL = 'info@mamecapital.com';
// Sender of both emails: an alias of the script owner's account (Gmail "Send mail as").
const FROM_EMAIL = 'info@mamecapital.com';
const TIME_ZONE = 'Europe/Zurich';

// Columns A–N are filled by this script. Add your own columns (Owner, Next step, Notes…) after them.
const HEADERS = ['Ref', 'Received', 'Name', 'Email', 'Phone', 'Company', 'Role', 'Interest',
  'Asset class', 'Region', 'Size', 'Country', 'Message', 'Status'];

const AUTO_REPLY_SUBJECT = 'Your enquiry to MAME Capital';
const autoReplyBody_ = (e) => `Dear ${e.name},

Thank you for your enquiry. It has reached us, and we will be in touch within two business days.

Your enquiry is treated confidentially. We share your details with a potential counterparty only after you have agreed to that specific introduction.

Kind regards

MAME Capital GmbH
Bahnhofstrasse 10, 8001 Zürich
+41 43 456 2510 · mamecapital.com

Ref: ${e.id}`;

/** Run once from the editor: creates the header row and the secret key. */
function setup() {
  const sheet = getSheet_();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('WEBHOOK_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('WEBHOOK_KEY', key);
  }
  Logger.log('WEBHOOK_KEY: ' + key);
  Logger.log('After deploying, set WEBHOOK_URL in Cloudflare to: <web app URL>?key=' + key);
}

/** Run from the editor to test the whole flow with a sample enquiry (sends both emails to info@). */
function testEnquiry() {
  const e = {
    type: 'enquiry',
    id: 'test-' + Date.now(),
    created_at: new Date().toISOString(),
    name: 'Test Enquiry',
    email: NOTIFY_EMAIL,
    phone: '+41791234567',
    company: 'Test AG',
    role: 'Investor or family office',
    interest: 'Capital introduction',
    asset_class: 'Private debt',
    region: 'Switzerland',
    size: 'CHF 5–20m',
    country: 'CH',
    message: 'This is a test enquiry from the Apps Script editor.',
  };
  Logger.log(JSON.stringify(handleEnquiry_(e)));
}

function doPost(request) {
  const key = PropertiesService.getScriptProperties().getProperty('WEBHOOK_KEY');
  if (!key || !request || !request.parameter || request.parameter.key !== key) {
    return json_({ ok: false, error: 'unauthorized' });
  }
  let e;
  try {
    e = JSON.parse(request.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'invalid json' });
  }
  if (e.type !== 'enquiry' || !e.id || !e.email || !e.name) {
    return json_({ ok: false, error: 'invalid enquiry' });
  }
  try {
    return json_(handleEnquiry_(e));
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err) });
  }
}

function handleEnquiry_(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_();
    // Ignore duplicates (e.g. if the website resends an enquiry).
    if (sheet.getLastRow() > 1 && sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
      .createTextFinder(e.id).matchEntireCell(true).findNext()) {
      return { ok: true, duplicate: true };
    }
    const received = Utilities.formatDate(new Date(e.created_at || Date.now()), TIME_ZONE, 'yyyy-MM-dd HH:mm');
    sheet.appendRow([
      e.id, received, e.name, e.email, e.phone, e.company, e.role, e.interest,
      e.asset_class, e.region, e.size, e.country, e.message, 'New',
    ].map(cell_));
  } finally {
    lock.releaseLock();
  }

  sendMail_({
    to: e.email,
    subject: AUTO_REPLY_SUBJECT,
    body: autoReplyBody_(e),
    name: 'MAME Capital',
    replyTo: NOTIFY_EMAIL,
  });

  sendMail_({
    to: NOTIFY_EMAIL,
    subject: `New enquiry: ${e.interest} — ${e.name}`,
    body: [
      `Name: ${e.name}`,
      `Email: ${e.email}`,
      `Phone: ${e.phone || '—'}`,
      `Company: ${e.company || '—'}`,
      `Role: ${e.role}`,
      `Interested in: ${e.interest}`,
      `Asset class: ${e.asset_class || '—'}`,
      `Region: ${e.region || '—'}`,
      `Indicative size: ${e.size || '—'}`,
      `Country (by IP): ${e.country || '—'}`,
      '',
      e.message,
      '',
      `Ref: ${e.id}`,
      `Sheet: ${SpreadsheetApp.getActive().getUrl()}`,
    ].join('\n'),
    name: 'MAME website',
    replyTo: e.email,
  });

  return { ok: true };
}

// Sends a plain-text email from FROM_EMAIL via the Gmail API (send-only permission).
function sendMail_({ to, subject, body, name, replyTo }) {
  const b64 = (str) => Utilities.base64Encode(str, Utilities.Charset.UTF_8);
  const mime = [
    `From: =?UTF-8?B?${b64(name)}?= <${FROM_EMAIL}>`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(body).match(/.{1,76}/g).join('\r\n'),
  ].join('\r\n');
  Gmail.Users.Messages.send({ raw: Utilities.base64EncodeWebSafe(mime, Utilities.Charset.UTF_8) }, 'me');
}

function getSheet_() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

// Store as plain text: stops "+41…" turning into a number and blocks formula injection (=, +, -, @).
function cell_(v) {
  const s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
