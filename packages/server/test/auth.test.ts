import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authByToken, login, logout, register } from '../src/auth.ts';
import { openDb, type Db } from '../src/db.ts';

let dbPath: string;
let db: Db;

function freshDb(): Db {
  dbPath = path.join(os.tmpdir(), `gwent-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  db = openDb(dbPath);
  return db;
}

afterEach(() => {
  db?.close();
  try {
    fs.unlinkSync(dbPath);
    fs.unlinkSync(dbPath + '-wal');
    fs.unlinkSync(dbPath + '-shm');
  } catch {
    /* ignore */
  }
});

describe('auth', () => {
  it('registers and logs in', () => {
    const d = freshDb();
    const reg = register(d, 'Geralt', 'password123');
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    expect(reg.user.username).toBe('Geralt');
    expect(reg.user.wins).toBe(0);
    expect(reg.token.length).toBeGreaterThan(20);

    const byTok = authByToken(d, reg.token);
    expect(byTok?.username).toBe('Geralt');

    const log = login(d, 'geralt', 'password123');
    expect(log.ok).toBe(true);
  });

  it('rejects duplicate usernames case-insensitively', () => {
    const d = freshDb();
    expect(register(d, 'Triss', 'password123').ok).toBe(true);
    const dup = register(d, 'triss', 'password123');
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe('username_taken');
  });

  it('rejects bad password and short username', () => {
    const d = freshDb();
    expect(register(d, 'ab', 'password123').ok).toBe(false);
    expect(register(d, 'ValidName', 'short').ok).toBe(false);
    register(d, 'Yennefer', 'password123');
    const bad = login(d, 'Yennefer', 'wrongpassword');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('bad_credentials');
  });

  it('invalidates session on logout', () => {
    const d = freshDb();
    const reg = register(d, 'Ciri', 'password123');
    if (!reg.ok) throw new Error('reg failed');
    logout(d, reg.token);
    expect(authByToken(d, reg.token)).toBeNull();
  });

  it('does not write on every validation', () => {
    const d = freshDb();
    const reg = register(d, 'Dandelion', 'password123');
    if (!reg.ok) throw new Error('reg failed');
    const expiry = () =>
      (d.prepare(`SELECT expires_at FROM sessions`).get() as { expires_at: number }).expires_at;

    const before = expiry();
    for (let i = 0; i < 25; i++) expect(authByToken(d, reg.token)).not.toBeNull();
    expect(expiry()).toBe(before);
  });

  it('slides the idle window once the throttle has elapsed', () => {
    const d = freshDb();
    const reg = register(d, 'Zoltan', 'password123');
    if (!reg.ok) throw new Error('reg failed');

    // Backdate the window so the next use is more than an hour past the last slide.
    d.prepare(`UPDATE sessions SET expires_at = expires_at - ?`).run(2 * 60 * 60 * 1000);
    const before = (d.prepare(`SELECT expires_at FROM sessions`).get() as { expires_at: number }).expires_at;
    expect(authByToken(d, reg.token)).not.toBeNull();
    const after = (d.prepare(`SELECT expires_at FROM sessions`).get() as { expires_at: number }).expires_at;
    expect(after).toBeGreaterThan(before);
  });

  it('expires a session at the absolute cap however often it is used', () => {
    const d = freshDb();
    const reg = register(d, 'Regis', 'password123');
    if (!reg.ok) throw new Error('reg failed');

    // A session issued 91 days ago whose idle window was slid forward yesterday:
    // still well inside the idle window, but past the hard lifetime cap.
    const now = Date.now();
    d.prepare(`UPDATE sessions SET created_at = ?, expires_at = ?`).run(
      now - 91 * 24 * 60 * 60 * 1000,
      now + 29 * 24 * 60 * 60 * 1000,
    );
    expect(authByToken(d, reg.token)).toBeNull();
    expect(d.prepare(`SELECT COUNT(*) c FROM sessions`).get()).toEqual({ c: 0 });
  });

  it('never slides the idle window past the absolute cap', () => {
    const d = freshDb();
    const reg = register(d, 'Yarpen', 'password123');
    if (!reg.ok) throw new Error('reg failed');

    // 80 days old: a full 30-day slide would overshoot the 90-day cap.
    const now = Date.now();
    const createdAt = now - 80 * 24 * 60 * 60 * 1000;
    d.prepare(`UPDATE sessions SET created_at = ?, expires_at = ?`).run(createdAt, now + 60 * 60 * 1000);
    expect(authByToken(d, reg.token)).not.toBeNull();
    const { expires_at } = d.prepare(`SELECT expires_at FROM sessions`).get() as { expires_at: number };
    expect(expires_at).toBe(createdAt + 90 * 24 * 60 * 60 * 1000);
  });
});
