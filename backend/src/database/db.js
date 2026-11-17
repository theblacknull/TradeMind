const { Pool } = require('pg');

let pool = null;

const getPool = () => {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
};

const PROFILE_COLUMNS = [
  'riskAversion', 'volatilityTolerance', 'growthFocus', 'cryptoExperience',
  'innovationTrust', 'impactInterest', 'diversification', 'holdingPatience',
  'monitoringFrequency', 'adviceOpenness',
];

const connectDB = async () => {
  if (!process.env.DATABASE_URL) return;
  const scores = PROFILE_COLUMNS
    .map((c) => `"${c}" INTEGER NOT NULL CHECK ("${c}" BETWEEN 1 AND 10)`)
    .join(',\n      ');
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      ${scores},
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
};

module.exports = connectDB;
module.exports.getPool = getPool;
module.exports.PROFILE_COLUMNS = PROFILE_COLUMNS;
