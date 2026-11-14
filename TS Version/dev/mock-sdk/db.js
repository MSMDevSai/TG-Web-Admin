import { sqlite, registry } from './core.js';
const col = (type, name, o = {}) => {
  const c = { type, name, mode: o.mode || null, pk: false, auto: false, nn: false, def: undefined, uq: false };
  c.primaryKey = (x) => { c.pk = true; if (x && x.autoIncrement) c.auto = true; return c; };
  c.notNull = () => { c.nn = true; return c; };
  c.default = (v) => { c.def = v; return c; };
  c.unique = () => { c.uq = true; return c; };
  return c;
};
export const integer = (n, o) => col('INTEGER', n, o);
export const text = (n, o) => col('TEXT', n, o);
export const boolean = (n) => col('INTEGER', n, { mode: 'boolean' });
export const json = (n) => col('TEXT', n, { mode: 'json' });
export const blob = (n) => col('BLOB', n);
export const index = (n) => ({ on: (...c) => ({ idx: n, cols: c }) });
export function table(name, cols, extras) {
  const t = { __name: name, __cols: {} };
  const defs = [];
  for (const [k, c] of Object.entries(cols)) {
    const ref = { ...c, jsKey: k, table: name }; t[k] = ref; t.__cols[k] = ref;
    let d = `"${c.name}" ${c.type}`;
    if (c.pk) d += ' PRIMARY KEY' + (c.auto ? ' AUTOINCREMENT' : '');
    if (c.nn) d += ' NOT NULL';
    if (c.def !== undefined) d += ' DEFAULT ' + (typeof c.def === 'boolean' ? (c.def ? 1 : 0) : typeof c.def === 'number' ? c.def : `'${String(c.def).replace(/'/g, "''")}'`);
    defs.push(d);
  }
  sqlite.exec(`CREATE TABLE "${name}" (${defs.join(', ')})`);
  registry.push(t);
  return t;
}
const enc = (c, v) => v === null || v === undefined ? null : c.mode === 'boolean' ? (v ? 1 : 0) : c.mode === 'json' ? JSON.stringify(v) : v;
const dec = (c, v) => v === null || v === undefined ? null : c.mode === 'boolean' ? !!v : c.mode === 'json' ? JSON.parse(v) : (c.type === 'BLOB' ? new Uint8Array(v) : v);
const cond = (o) => ({ ...o });
export const eq = (c, v) => cond({ s: `"${c.name}" = ?`, p: [enc(c, v)] });
export const lt = (c, v) => cond({ s: `"${c.name}" < ?`, p: [v] });
export const gt = (c, v) => cond({ s: `"${c.name}" > ?`, p: [v] });
export const isNotNull = (c) => cond({ s: `"${c.name}" IS NOT NULL`, p: [] });
export const isNull = (c) => cond({ s: `"${c.name}" IS NULL`, p: [] });
export const inArray = (c, a) => cond({ s: `"${c.name}" IN (${a.map(() => '?').join(',')})`, p: a });
export const and = (...cs) => { cs = cs.filter(Boolean); return cond({ s: cs.map((x) => `(${x.s})`).join(' AND '), p: cs.flatMap((x) => x.p) }); };
export const desc = (c) => `"${c.name}" DESC`;
export const asc = (c) => `"${c.name}" ASC`;
export function sql(strings, ...vals) { let s = strings[0]; const p = []; vals.forEach((v, i) => { s += '?' + strings[i + 1]; p.push(v); }); return { text: s, params: p }; }

class Sel {
  constructor(t) { this.t = null; this.w = null; this.o = []; this.l = null; }
  from(t) { this.t = t; return this; }
  where(...cs) { this.w = and(...cs); return this; }
  orderBy(...o) { this.o = o; return this; }
  limit(n) { this.l = n; return this; }
  _q() { let s = `SELECT * FROM "${this.t.__name}"`; const p = []; if (this.w) { s += ' WHERE ' + this.w.s; p.push(...this.w.p); } if (this.o.length) s += ' ORDER BY ' + this.o.join(', '); if (this.l) s += ' LIMIT ' + this.l; return [s, p]; }
  _dec(r) { const o = {}; for (const [k, c] of Object.entries(this.t.__cols)) o[k] = dec(c, r[c.name]); return o; }
  async all() { const [s, p] = this._q(); return sqlite.prepare(s).all(...p).map((r) => this._dec(r)); }
  async get() { const [s, p] = this._q(); const r = sqlite.prepare(s).get(...p); return r ? this._dec(r) : undefined; }
}
class Ins {
  constructor(t) { this.t = t; }
  values(v) { this.v = Array.isArray(v) ? v : [v]; return this; }
  onConflictDoUpdate({ target, set }) { this.oc = { target, set }; return this; }
  async run() {
    for (const row of this.v) {
      const ks = Object.keys(row).filter((k) => row[k] !== undefined);
      for (const k of ks) if (!this.t.__cols[k]) throw new Error(`unknown column ${k} in ${this.t.__name}`);
      let s = `INSERT INTO "${this.t.__name}" (${ks.map((k) => `"${this.t.__cols[k].name}"`).join(',')}) VALUES (${ks.map(() => '?').join(',')})`;
      const p = ks.map((k) => enc(this.t.__cols[k], row[k]));
      if (this.oc) { const sk = Object.keys(this.oc.set); s += ` ON CONFLICT("${this.oc.target.name}") DO UPDATE SET ${sk.map((k) => `"${this.t.__cols[k].name}"=?`).join(',')}`; p.push(...sk.map((k) => enc(this.t.__cols[k], this.oc.set[k]))); }
      sqlite.prepare(s).run(...p);
    }
    return { rowsAffected: this.v.length };
  }
}
class Upd {
  constructor(t) { this.t = t; }
  set(o) { this.s = o; return this; }
  where(...cs) { this.w = and(...cs); return this; }
  async run() { const ks = Object.keys(this.s).filter((k) => this.s[k] !== undefined); for (const k of ks) if (!this.t.__cols[k]) throw new Error(`unknown column ${k}`);
    let q = `UPDATE "${this.t.__name}" SET ${ks.map((k) => `"${this.t.__cols[k].name}"=?`).join(',')}`; const p = ks.map((k) => enc(this.t.__cols[k], this.s[k]));
    if (this.w) { q += ' WHERE ' + this.w.s; p.push(...this.w.p); } sqlite.prepare(q).run(...p); return {}; }
}
class Del { constructor(t) { this.t = t; } where(...cs) { this.w = and(...cs); return this; }
  async run() { let q = `DELETE FROM "${this.t.__name}"`; const p = []; if (this.w) { q += ' WHERE ' + this.w.s; p.push(...this.w.p); } sqlite.prepare(q).run(...p); return {}; } }
export const dbImpl = {
  select: () => new Sel(), insert: (t) => new Ins(t), update: (t) => new Upd(t), delete: (t) => new Del(t),
  async $count(t, c) { let q = `SELECT COUNT(*) n FROM "${t.__name}"`; const p = []; if (c) { q += ' WHERE ' + c.s; p.push(...c.p); } return sqlite.prepare(q).get(...p).n; },
  async all(s) { return sqlite.prepare(s.text).all(...s.params); },
};
