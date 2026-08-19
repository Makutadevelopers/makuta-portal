// Projects (sites) moved to the DB in migration 053 — HO manages them at
// /projects (Project Master). This list is now the SEED (migration 053 inserts
// exactly these six) and the runtime fallback used by useSites() while the API
// request is in flight or has failed, so a project dropdown is never empty.
// Read projects via useSites(); don't import this directly for dropdowns.
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

// Bank dropdown options for payment modals. "Other" is a literal pickable
// value — selecting it stores the string "Other" against the payment, no
// free-text entry.
export const BANKS = ['HDFC', 'SBI', 'ICICI', 'Axis', 'Kotak', 'Yes Bank', 'Canara'];

export const MINOR_LIMIT = 50000;  // ₹50,000 — site accountants can pay below this
