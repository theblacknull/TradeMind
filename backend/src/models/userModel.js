const { getPool, PROFILE_COLUMNS } = require('../database/db');

const EMAIL_RE = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
const FIELDS = ['username', 'password', 'email', ...PROFILE_COLUMNS];

// Postgres-backed user model exposing the small subset of the former
// Mongoose API the services rely on: new User(data), User.findOne(query), user.save().
class User {
  constructor(data = {}) {
    this.id = data.id;
    this._persisted = Boolean(data._persisted);
    FIELDS.forEach((f) => { this[f] = data[f]; });
  }

  static async findOne(query = {}) {
    const clauses = Array.isArray(query.$or) ? query.$or : [query];
    const params = [];
    const where = clauses.map((c) => {
      const parts = Object.entries(c).map(([k, v]) => {
        if (!FIELDS.includes(k)) throw new Error(`Unknown field: ${k}`);
        params.push(k === 'email' ? String(v).trim().toLowerCase() : v);
        return `"${k}" = $${params.length}`;
      });
      return `(${parts.join(' AND ')})`;
    }).join(' OR ');
    if (!params.length) return null;
    const { rows } = await getPool().query(`SELECT * FROM users WHERE ${where} LIMIT 1`, params);
    return rows[0] ? new User({ ...rows[0], _persisted: true }) : null;
  }

  validate() {
    if (!this.username || !String(this.username).trim()) throw new Error('username is required');
    if (!this.password) throw new Error('password is required');
    this.username = String(this.username).trim();
    this.email = String(this.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(this.email)) throw new Error('Please enter a valid email');
    PROFILE_COLUMNS.forEach((f) => {
      const v = Number(this[f]);
      if (!Number.isInteger(v) || v < 1 || v > 10) throw new Error(`${f} must be between 1 and 10`);
    });
  }

  async save() {
    this.validate();
    const values = FIELDS.map((f) => this[f]);
    const cols = FIELDS.map((f) => `"${f}"`);
    try {
      if (this._persisted) {
        const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
        await getPool().query(
          `UPDATE users SET ${sets}, "updatedAt" = NOW() WHERE id = $${cols.length + 1}`,
          [...values, this.id],
        );
      } else {
        const marks = cols.map((_, i) => `$${i + 1}`).join(', ');
        const { rows } = await getPool().query(
          `INSERT INTO users (${cols.join(', ')}) VALUES (${marks}) RETURNING id`,
          values,
        );
        this.id = rows[0].id;
        this._persisted = true;
      }
    } catch (err) {
      if (err.code === '23505') {
        throw new Error(/email/.test(err.constraint || '') ? 'Email already exists' : 'Username already exists');
      }
      throw err;
    }
    return this;
  }
}

module.exports = User;
