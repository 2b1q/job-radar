// The title filter the example profile ships for a backend search, held to the
// titles that measured it. Every "drop" below passed the previous list in a live
// run; every "keep" is a title the rewrite must not catch. Titles keep the
// shape that was measured - where the language or role word stands - and lose
// the wording that would point at one employer.

import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.JOBS_PROFILES = 'profiles.example.json';
process.env.JOBS_PROFILE = 'backend-node';
const { titleFilter } = await import('../params.mjs');

const excluded = (title) => titleFilter().exclude.some((re) => re.test(title));

const ROLE_CLASSES = [
  'Senior Lawyer', 'Content Team Lead', 'Expenses Specialist',
  'Solution Architect, APAC', 'Solutions Architect, EMEA', 'Credit Risk Manager',
  'Backend Senior Manager', 'Backend Engineer - Assistant Vice President',
  'Accelerator Program - Backend Engineer',
];

// The language stood before "Backend" or in brackets at the end, never next to
// the role word, so a `<language> engineer` pattern passed all of these.
const LANGUAGE_ANYWHERE = [
  'Java Backend Engineer – Payments', 'Backend Engineer - Payment (Java)',
  'Backend Developer (Java)', 'Software Engineer (Backend, Java) - Platform',
  'Senior Backend Engineer, Rust', 'Senior Backend Engineer (Trading) – Golang',
  'Senior Backend Engineer (.NET)', 'C++ Engineer',
];

const KEEP = [
  'Senior Backend Engineer', 'Backend Engineer (Node.js)', 'Senior Node.js Engineer',
  'Full Stack Engineer (TypeScript, Node.js)', 'Backend Engineer, JavaScript',
  'Backend Engineer - Python/Node.js', 'Trust & Safety Backend Engineer',
  'Software Engineer, Backend', 'Staff Software Engineer, Payments',
];

test('a role class the backend profile excludes is dropped', () => {
  assert.deepEqual(ROLE_CLASSES.filter((t) => !excluded(t)), []);
});

test('a language is caught wherever it stands in the title', () => {
  assert.deepEqual(LANGUAGE_ANYWHERE.filter((t) => !excluded(t)), []);
});

test('and a title that also names Node, TypeScript or JavaScript is kept', () => {
  // `JavaScript` must not read as `Java`, and `Trust` must not read as `Rust`.
  assert.deepEqual(KEEP.filter(excluded), []);
});
