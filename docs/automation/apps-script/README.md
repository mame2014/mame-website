# Website enquiries → Google Sheet (Apps Script)

For every contact-form enquiry, the website (`functions/api/contact.js`) stores it in D1 and POSTs it to this script, which:

1. adds a row to the **Leads** sheet,
2. sends the auto-reply to the sender from info@mamecapital.com,
3. sends the notification to info@mamecapital.com (reply goes straight to the sender).

## Setup (signed in as rene.prince@mamecapital.com)

0. info@ is an alias of rene.prince@ (Admin console → user → Alternate email). For Gmail to send *from* it, it must also be listed under **Gmail → Settings → See all settings → Accounts → "Send mail as"**. If missing: *Add another email address* → name "MAME Capital", address info@mamecapital.com, keep *Treat as an alias* ticked → Next. No verification is needed for your own alias.

1. Create a Google Sheet named **MAME Leads**.
2. **Extensions → Apps Script**. Replace the contents of `Code.gs` with [Code.gs](Code.gs).
3. **Project Settings** (gear) → tick **Show "appsscript.json"** → back in the editor, replace `appsscript.json` with [appsscript.json](appsscript.json). Save.
4. Select the function **`setup`** → **Run** → allow access when asked. Google should ask for exactly two permissions: *only this spreadsheet* and *send email on your behalf*. If it asks for more, the manifest wasn't saved. It creates the `Leads` tab with headers and logs the **WEBHOOK_KEY** (View → Logs / Execution log).
5. Optional check: run **`testEnquiry`** → a test row appears and two emails arrive at info@ (sent from the info@ alias). Delete the test row afterwards.
6. **Deploy → New deployment** → type **Web app** → *Execute as:* **Me** · *Who has access:* **Anyone** → **Deploy** → copy the **Web app URL** (ends in `/exec`).
7. In Cloudflare (**Workers & Pages → mame-website → Settings → Variables and Secrets**), add as type **Secret**:
   `WEBHOOK_URL` = `<Web app URL>?key=<WEBHOOK_KEY>`
8. Push / redeploy the site so the variable takes effect, then send a real test through the form.

"Anyone" access is required so Cloudflare can call the script; the long secret key in the URL is what protects it. Keep the URL private.

## Changing things later

- **Reply text:** edit `AUTO_REPLY_BODY` in Code.gs, then **Deploy → Manage deployments → Edit → Version: New version → Deploy** (the URL stays the same).
- **Your own CRM columns:** add them after column N (Status). The script only writes A–N.
- **New secret key:** delete `WEBHOOK_KEY` under Project Settings → Script properties, run `setup` again, update `WEBHOOK_URL` in Cloudflare.

## Limits

Google Workspace allows 1,500 emails/day from scripts; each enquiry uses 2.
