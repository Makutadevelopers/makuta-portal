#!/usr/bin/env node
// generatePasswordHashes.js
// Run: node server/src/db/seeds/generatePasswordHashes.js
// Generates bcrypt hashes (12 rounds) for all 8 users and updates 001_seed_users.sql

const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const ROUNDS = 12;

const users = [
  { name: 'Rajesh Kumar',  password: 'ho123',  placeholder: '__HASH_RAJESH__' },
  { name: 'Arun Makuta',   password: 'md123',  placeholder: '__HASH_ARUN__' },
  { name: 'Suresh Reddy',  password: 'nv123',  placeholder: '__HASH_SURESH__' },
  { name: 'Priya Sharma',  password: 'tr123',  placeholder: '__HASH_PRIYA__' },
  { name: 'Mahesh Babu',   password: 'hz123',  placeholder: '__HASH_MAHESH__' },
  { name: 'Kavitha Rao',   password: 'gw123',  placeholder: '__HASH_KAVITHA__' },
  { name: 'Venkat Naidu',  password: 'aa123',  placeholder: '__HASH_VENKAT__' },
  { name: 'Lakshmi Devi',  password: 'of123',  placeholder: '__HASH_LAKSHMI__' },
];

async function main() {
  console.log(`Generating bcrypt hashes (${ROUNDS} rounds)...\n`);

  const results = [];
  for (const user of users) {
    const hash = await bcrypt.hash(user.password, ROUNDS);
    results.push({ ...user, hash });
    console.log(`  ${user.name.padEnd(16)} (${user.password}) -> ${hash}`);
  }

  // Update the SQL seed file in-place
  const sqlPath = path.join(__dirname, '001_seed_users.sql');
  let sql = fs.readFileSync(sqlPath, 'utf-8');

  for (const { placeholder, hash } of results) {
    sql = sql.replace(placeholder, hash);
  }

  fs.writeFileSync(sqlPath, sql, 'utf-8');
  console.log(`\nUpdated: ${sqlPath}`);
  console.log('You can now run: npx ts-node src/db/seeds/runSeeds.ts');
}

main().catch((err) => {
  console.error('Failed to generate hashes:', err);
  process.exit(1);
});
