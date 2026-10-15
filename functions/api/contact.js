// POST /api/contact — contact form handler (Cloudflare Pages Function).
//
// Every integration is optional and switched on by its binding / variable
// (Pages project → Settings → Bindings / Variables and Secrets):
//   DB                    D1 binding: every enquiry is stored first (table auto-created)
//   TURNSTILE_SECRET_KEY  spam protection (pair with PUBLIC_TURNSTILE_SITE_KEY at build time)
//   RESEND_API_KEY        email notification via Resend, with NOTIFY_EMAIL and FROM_EMAIL
//   WEBHOOK_URL           JSON POST of each enquiry for automation (Make, n8n, Zapier…),
//                         optionally signed with WEBHOOK_SECRET in the X-Webhook-Secret header

import { ROLES, INTERESTS, ASSET_CLASSES, REGIONS, SIZES } from '../../src/lib/contact-options.js';

const SCHEMA = `CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  role TEXT NOT NULL,
  interest TEXT NOT NULL,
  asset_class TEXT,
  region TEXT,
  size TEXT,
  message TEXT NOT NULL,
  country TEXT,
  forwarded INTEGER NOT NULL DEFAULT 0
)`;

export async function onRequestPost({ request, env, waitUntil }) {
  const wantsJson = (request.headers.get('accept') || '').includes('application/json');

  let form;
  try {
    form = await request.formData();
  } catch {
    return reply(wantsJson, 400, { ok: false, error: 'Invalid request.' });
  }
  const get = (k) => String(form.get(k) ?? '').trim();

  // Honeypot: bots fill the hidden field. Pretend success, store nothing.
  if (get('website')) return reply(wantsJson, 200, { ok: true });

  const data = {
    name: get('name'),
    email: get('email').toLowerCase(),
    company: get('company'),
    phone: get('phone'),
    role: get('role'),
    interest: get('interest'),
    asset_class: get('asset_class'),
    region: get('region'),
    size: get('size'),
    message: get('message'),
  };

  const errors = {};
  if (!data.name || data.name.length > 120) errors.name = 'Please enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email) || data.email.length > 254) errors.email = 'Please enter a valid email address.';
  if (data.company.length > 160) errors.company = 'Please shorten this field.';
  if (data.phone) {
    // International format with country code, stored as E.164 (e.g. +41434562510). "00" prefix is accepted as "+".
    // "(0)" is the domestic trunk zero written after the country code, e.g. +41 (0)79 …; drop it.
    const phone = data.phone.replace(/\(0\)/g, '').replace(/[\s().\-\/]/g, '').replace(/^00/, '+');
    if (/^\+[1-9]\d{7,14}$/.test(phone)) data.phone = phone;
    else errors.phone = 'Please enter the number with country code, e.g. +41 79 123 45 67.';
  }
  if (!ROLES.includes(data.role)) errors.role = 'Please choose an option.';
  if (!INTERESTS.includes(data.interest)) errors.interest = 'Please choose an option.';
  if (data.asset_class && !ASSET_CLASSES.includes(data.asset_class)) errors.asset_class = 'Please choose an option.';
  if (data.region && !REGIONS.includes(data.region)) errors.region = 'Please choose an option.';
  if (data.size && !SIZES.includes(data.size)) errors.size = 'Please choose an option.';
  if (data.message.length < 10 || data.message.length > 5000) errors.message = 'Please write a short message (10–5000 characters).';
  if (get('consent') !== 'yes') errors.consent = 'Please confirm you have read the privacy policy.';
  if (Object.keys(errors).length) {
    return reply(wantsJson, 422, { ok: false, error: 'Please check the highlighted fields.', fields: errors });
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const passed = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, get('cf-turnstile-response'), request.headers.get('CF-Connecting-IP'));
    if (!passed) return reply(wantsJson, 403, { ok: false, error: 'Spam check failed. Please reload the page and try again.' });
  }

  if (!env.DB && !env.RESEND_API_KEY && !env.WEBHOOK_URL) {
    // Nothing would receive the enquiry; fail loudly rather than lose it.
    return reply(wantsJson, 503, { ok: false, error: 'The form is not available right now. Please email info@mamecapital.com.' });
  }

  const enquiry = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    ...data,
    country: request.cf?.country || null,
  };

  if (env.DB) {
    try {
      await env.DB.exec(SCHEMA.replace(/\s*\n\s*/g, ' '));
      await env.DB.prepare(
        `INSERT INTO enquiries (id, created_at, name, email, company, phone, role, interest, asset_class, region, size, message, country)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        enquiry.id, enquiry.created_at, enquiry.name, enquiry.email, enquiry.company || null, enquiry.phone || null,
        enquiry.role, enquiry.interest, enquiry.asset_class || null, enquiry.region || null, enquiry.size || null,
        enquiry.message, enquiry.country
      ).run();
    } catch (err) {
      console.error('D1 insert failed', err);
      if (!env.RESEND_API_KEY && !env.WEBHOOK_URL) {
        return reply(wantsJson, 500, { ok: false, error: 'Something went wrong. Please email info@mamecapital.com.' });
      }
    }
  }

  // Notifications run after the response is sent; the stored row is the source of truth.
  waitUntil(Promise.allSettled([notifyEmail(env, enquiry), forwardWebhook(env, enquiry)]));

  return reply(wantsJson, 200, { ok: true });
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const out = await res.json();
    return out.success === true;
  } catch (err) {
    console.error('Turnstile verification failed', err);
    return false;
  }
}

async function notifyEmail(env, e) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL || !env.FROM_EMAIL) return;
  const lines = [
    `Name: ${e.name}`,
    `Email: ${e.email}`,
    `Company: ${e.company || '—'}`,
    `Phone: ${e.phone || '—'}`,
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
  ];
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: env.NOTIFY_EMAIL.split(',').map((s) => s.trim()),
      reply_to: e.email,
      subject: `New enquiry: ${e.interest} — ${e.name}`,
      text: lines.join('\n'),
    }),
  });
  if (!res.ok) console.error('Resend failed', res.status, await res.text());
}

async function forwardWebhook(env, e) {
  if (!env.WEBHOOK_URL) return;
  const headers = { 'Content-Type': 'application/json' };
  if (env.WEBHOOK_SECRET) headers['X-Webhook-Secret'] = env.WEBHOOK_SECRET;
  const res = await fetch(env.WEBHOOK_URL, { method: 'POST', headers, body: JSON.stringify({ type: 'enquiry', ...e }) });
  if (!res.ok) {
    console.error('Webhook failed', res.status);
    return;
  }
  if (env.DB) await env.DB.prepare('UPDATE enquiries SET forwarded = 1 WHERE id = ?').bind(e.id).run();
}

function reply(wantsJson, status, body) {
  if (wantsJson) return Response.json(body, { status });
  // Fallback for browsers without JavaScript.
  if (body.ok) return new Response(null, { status: 303, headers: { Location: '/thanks' } });
  return new Response(`${body.error}\n\nPlease go back and try again, or email info@mamecapital.com.`, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
