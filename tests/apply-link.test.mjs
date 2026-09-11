// Where a link goes, read from its host.
//
// One board carries the employer's own link and says nothing about it, so every
// posting arrived as "nobody checked" while most pointed straight at an
// applicant tracking system. A hostname is evidence, not proof, which is why
// the answer has three values and an unrecognised host stays null.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { leadsToEmployer } from '../adapters/_shared/apply-link.mjs';

test('an applicant tracking system is the employer front door', () => {
  for (const url of [
    'https://jobs.ashbyhq.com/example/1',
    'https://job-boards.greenhouse.io/example/jobs/1',
    'https://job-boards.eu.greenhouse.io/example/jobs/1',
    'https://jobs.lever.co/example/1',
    'https://example.bamboohr.com/careers/1',
    'https://jobs.smartrecruiters.com/example/1',
  ]) assert.equal(leadsToEmployer(url), true, url);
});

test('a company careers subdomain is too', () => {
  assert.equal(leadsToEmployer('https://careers.example.io/roles/1'), true);
  assert.equal(leadsToEmployer('https://jobs.example.com/1'), true);
});

test('somebody else listing is not', () => {
  for (const url of [
    'https://www.linkedin.com/jobs/view/1',
    'https://hh.ru/vacancy/1',
    'https://web3.career/x/1',
  ]) assert.equal(leadsToEmployer(url), false, url);
});

test('an aggregator wins over the careers-subdomain shape', () => {
  // Order matters: `jobs.` in front of an aggregator is still the aggregator.
  assert.equal(leadsToEmployer('https://jobs.linkedin.com/view/1'), false);
  // The boards looked at and not taken are on that list for this reason: each
  // serves its postings under a `jobs.` or `careers.` host of its own.
  assert.equal(leadsToEmployer('https://jobs.superjob.ru/vacancy/1'), false);
});

test('a board this repo decided not to read is still a board', () => {
  // Measured in notes/sources-not-taken.md: on each of these the link stops at
  // the board, so a posting reaching one of them is not an application.
  for (const url of [
    'https://www.monster.com/job-openings/1',
    'https://russia.superjob.ru/vakansii/1.html',
    'https://gorodrabot.ru/vacancy/1',
    'https://hirify.me/job/1',
    'https://www.rabota.ru/vacancy/1',
    'https://zarplata.ru/vacancy/1',
  ]) assert.equal(leadsToEmployer(url), false, url);
});

test('anything the host cannot settle stays null, not a guess', () => {
  // A messenger link, a plain marketing page and a broken url are all real
  // cases here. Calling them false would be the same invention as true.
  for (const url of ['https://t.me/somechannel', 'https://example.com/about', 'not-a-url', null]) {
    assert.equal(leadsToEmployer(url), null, String(url));
  }
});

test('the board that carries these links now classifies them', async () => {
  const token = (url) => `x.${Buffer.from(JSON.stringify({ url })).toString('base64')}.y`;
  const board = [
    { id: 1, companyName: 'GammaCo', title: 'A', url: token('https://jobs.ashbyhq.com/gammaco/1'),
      country: 'RS', format: 'remote', salaryLabel: 'not stated', createdAtIso: '2026-09-01T00:00:00.000Z' },
    { id: 2, companyName: 'DeltaCo', title: 'B', url: token('https://www.linkedin.com/jobs/view/2'),
      country: 'RS', format: 'remote', salaryLabel: 'not stated', createdAtIso: '2026-09-01T00:00:00.000Z' },
    { id: 3, companyName: 'EpsilonCo', title: 'C', url: token('https://t.me/channel'),
      country: 'RS', format: 'remote', salaryLabel: 'not stated', createdAtIso: '2026-09-01T00:00:00.000Z' },
  ];
  globalThis.fetch = async (url) => ({
    ok: true, status: 200, text: async () => '',
    json: async () => (String(url).endsWith('/jobs/count')
      ? { totalCount: board.length }
      : { data: board, hasMore: false }),
  });
  const { search } = await import('../adapters/agilefluent.mjs');
  const [ats, aggregator, unknown] = await search({ roles: [] }, 1);
  assert.equal(ats.applyAtEmployer, true);
  assert.equal(ats.applyFrom, 'host', 'derived, and it says where from');
  assert.equal(aggregator.applyAtEmployer, false);
  assert.equal(unknown.applyAtEmployer, null);
});
