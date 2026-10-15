// Dropdown options for the contact form. Shared by the form (src/components/contact.astro)
// and the server-side validation (functions/api/contact.js) so they never drift apart.

export const ROLES = [
  'Investor or family office',
  'Company raising capital',
  'Real estate owner or seller',
  'Real estate buyer',
  'Developer',
  'Other',
];

export const INTERESTS = [
  'Deal sourcing (buy-side)',
  'Deal sourcing (sell-side)',
  'Capital introduction',
  'Securitization access',
];

export const ASSET_CLASSES = ['Real estate', 'Private debt', 'Private equity', 'Funds', 'Other'];

export const REGIONS = ['Switzerland', 'Europe', 'Gulf', 'Other'];

export const SIZES = ['< CHF 1m', 'CHF 1–5m', 'CHF 5–20m', 'CHF 20–50m', '> CHF 50m'];
