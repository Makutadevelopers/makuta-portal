// TODO: constants
export const SITES = [
  'Nirvana', 'Taranga', 'Horizon',
  'Green Wood Villas', 'Aruna Arcade', 'Office',
];

export const PURPOSES = [
  'Material', 'Steel', 'Cement', 'Bricks', 'Aggregates', 'Hardware', 'Tiles',
  'Plumbing Material', 'Electrical Material', 'Scaffolding', 'Admixtures',
  'Granite', 'Misc', 'RMC Service', 'Painting Materials', 'Doors',
  'Advertisement', 'Water Proofing', 'Consultant', 'Fire Fighting',
  'Contractor', 'Machinery', 'Loan', 'Miwan Shuttering', 'Tax',
  'Sales Refund', 'Lifts', 'Security Service', 'Diesel',
  'Ms Sections & Tubes & Pipes', 'CP & Sanitary', 'Windows',
  'General Supplies', 'Electrical',
];

export const PAYMENT_TYPES = ['Cheque', 'NEFT', 'RTGS', 'UPI', 'Cash'];

// Built-in bank list rendered as the first options on payment modals.
// Users can pick "Other…" to enter a name not in this list; the name is
// then remembered (see CUSTOM_BANKS_KEY) and added to the dropdown on
// subsequent visits.
export const BANKS = ['HDFC', 'SBI', 'ICICI', 'Axis', 'Kotak', 'Yes Bank', 'Canara'];

const CUSTOM_BANKS_KEY = 'makuta:customBanks';

export function loadCustomBanks(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_BANKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function addCustomBank(name: string): string[] {
  const trimmed = name.trim();
  const existing = loadCustomBanks();
  if (!trimmed) return existing;
  const known = new Set([...BANKS, ...existing].map(b => b.toLowerCase()));
  if (known.has(trimmed.toLowerCase())) return existing;
  const next = [...existing, trimmed];
  try { localStorage.setItem(CUSTOM_BANKS_KEY, JSON.stringify(next)); } catch { /* ignore quota */ }
  return next;
}

export const MINOR_LIMIT = 50000;  // ₹50,000 — site accountants can pay below this
