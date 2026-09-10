// The profile is edited far more often than the server is restarted.
//
// It used to be read once at import, so every edit needed a client restart —
// and a stale profile answered plausibly in the meantime, which is the failure
// this repository keeps finding. Now the file is stat'd before each use.
//
// No network. The profile is a temporary file, so nothing here reads anybody's.

import assert from 'node:assert/strict';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = `profiles.reload-${process.pid}.json`;
const FILE = join(HERE, '..', NAME);

const write = (roles) => writeFileSync(FILE, JSON.stringify({
  active: 'one',
  profiles: { one: { roles, grades: [], skills: { w3: ['node'] } } },
}, null, 2));

write(['first']);
process.env.JOBS_PROFILES = NAME;
const { afFilters, profileStatus, skillsFor } = await import('../params.mjs');

/** mtimeMs has sub-millisecond resolution but not infinite: make the edit distinct. */
const rewrite = (roles) => { const t = Date.now(); while (Date.now() === t); write(roles); };

test('the profile as it was at import', () => {
  assert.deepEqual(afFilters({}).roles, ['first']);
  assert.equal(profileStatus().profile, 'one');
});

test('an edit is picked up without a restart', () => {
  rewrite(['second']);
  assert.deepEqual(afFilters({}).roles, ['second'], 'the next call read the new file');
});

test('and everything derived from it moves together', () => {
  writeFileSync(FILE, JSON.stringify({
    active: 'one',
    profiles: { one: { roles: ['third'], grades: ['senior'], skills: { w3: ['react'] } } },
  }));
  assert.deepEqual(skillsFor('w3'), ['react']);
  assert.deepEqual(afFilters({}).grades, ['senior']);
});

test('a broken edit keeps the profile that worked, and says what is wrong', () => {
  writeFileSync(FILE, '{ this is not json');
  assert.deepEqual(afFilters({}).roles, ['third'], 'the last good profile still answers');
  const status = profileStatus();
  assert.match(status.error, /not readable as JSON/);
  assert.equal(status.profile, 'one');
});

test('and it recovers when the file is fixed', () => {
  rewrite(['fourth']);
  assert.deepEqual(afFilters({}).roles, ['fourth']);
  assert.equal(profileStatus().error, undefined);
});

test('the status says where it read from and when', () => {
  const status = profileStatus();
  assert.match(status.path, new RegExp(`${NAME}$`));
  assert.match(status.mtime, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(status.loadedAt, /^\d{4}-\d{2}-\d{2}T/);
});

after(() => { try { unlinkSync(FILE); } catch { /* best effort */ } });
