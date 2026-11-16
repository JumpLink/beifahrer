#!/usr/bin/env node
// Re-checks the agent catalog (packages/core/src/agents.ts) against each agent's own docs page.
// Needs the network and third-party sites, so it is NOT part of the PR gate: run it before a
// release (`npm run catalog:check`) or let .github/workflows/agent-catalog.yml run it weekly.
//
// Exit: 0 every agent verified · 1 a claim no longer appears (drift) · 2 nothing drifted, but a page
// could not be read (unverified, which is never a pass).
// Usage: node tools/check-agent-catalog.mjs [agent-id …]   (default: all)
import { AGENTS } from '../packages/core/src/agents.ts';
import { claimsOf, claimsExitCode, verify } from '../packages/core/src/agent-claims.ts';

const TIMEOUT_MS = 20_000;
const PAUSE_MS = 500;
// Says who is asking and why, so a docs site owner can tell this from a scraper.
const USER_AGENT =
  'Beifahrer-catalog-check (+https://github.com/JumpLink/beifahrer; checks 14 public docs pages per release)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(url) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/markdown;q=0.9,*/*;q=0.5' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { status: 0, body: '', error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

// One retry, and only when the first answer says nothing about the page (no response, 429, 5xx).
async function get(url) {
  const first = await once(url);
  if (first.status !== 0 && first.status !== 429 && first.status < 500) return first;
  await sleep(2_000);
  return once(url);
}

const wanted = process.argv.slice(2);
const agents = wanted.length ? AGENTS.filter((a) => wanted.includes(a.id)) : AGENTS;
if (agents.length === 0) {
  console.error(`no such agent: ${wanted.join(', ')}`);
  process.exit(64);
}

// Two entries may share a page (Claude Desktop, Other): one request per URL, not per entry.
const pages = new Map();
const verdicts = [];
for (const agent of agents) {
  if (!pages.has(agent.docs)) {
    if (pages.size > 0) await sleep(PAUSE_MS);
    pages.set(agent.docs, await get(agent.docs));
  }
  const v = verify(claimsOf(agent), pages.get(agent.docs));
  verdicts.push(v);
  const id = agent.id.padEnd(15);
  if (v.status === 'ok') console.log(`ok          ${id} ${v.checked} claims   ${agent.docs}`);
  else if (v.status === 'drifted') {
    console.error(`DRIFTED     ${id} no longer shows: ${v.missing.join('; ')}   ${agent.docs}`);
  } else console.warn(`unverified  ${id} ${v.reason}   ${agent.docs}`);
}

const count = (s) => verdicts.filter((v) => v.status === s).length;
console.log(`\n${count('ok')} ok, ${count('drifted')} drifted, ${count('unverified')} unverified`);
process.exit(claimsExitCode(verdicts));
