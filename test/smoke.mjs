// Headless smoke test: runs app.js's real render pipeline against the ESPN
// fixtures with a minimal DOM and a stubbed fetch. This verifies the UI
// actually renders game cards and a game detail (header + tabs) from parsed
// ESPN-shaped JSON, not just that the parser works.

import { SCOREBOARD_FIXTURE, SUMMARY_FIXTURE } from './fixtures.js';

class FakeElement {
  constructor(id) {
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.checked = true;
  }
  addEventListener() {}
  querySelectorAll() {
    return [];
  }
  closest() {
    return null;
  }
  getAttribute() {
    return '';
  }
  setAttribute() {}
}

const elements = new Map();
const fakeDocument = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  }
};

function fakeResponse(obj) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(obj);
    }
  };
}

globalThis.document = fakeDocument;
globalThis.window = { addEventListener() {} };
globalThis.location = { hash: '' };
globalThis.history = { replaceState() {} };
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/scoreboard?')) return fakeResponse(SCOREBOARD_FIXTURE);
  if (u.includes('/summary?')) return fakeResponse(SUMMARY_FIXTURE);
  return { ok: false, status: 404, async text() { return 'not found'; } };
};

await import('../app.js');

const scoreboard = fakeDocument.getElementById('scoreboard');
const detail = fakeDocument.getElementById('detail');

// Give the async loadScoreboard/loadSummary chain a couple of ticks.
await new Promise((r) => setTimeout(r, 25));

function assert(cond, message) {
  if (!cond) {
    console.error('SMOKE FAIL:', message);
    process.exit(1);
  }
}

const board = scoreboard.innerHTML;
const det = detail.innerHTML;

assert(board.includes('SEC'), 'scoreboard should render an SEC group');
assert(board.includes('Big Ten'), 'scoreboard should render a Big Ten group');
assert(!board.includes('Fresno'), 'scoreboard should filter out non-focused conferences');
assert(board.includes('Ohio St') || board.includes('Texas'), 'scoreboard should render team names');
assert(board.includes('game-card'), 'scoreboard should render game cards');

assert(det.includes('tab') || det.includes('Tabs'), 'detail should render tabs');
assert(det.includes('Play-by-Play') || det.includes('Team Stats') || det.includes('Player Stats'), 'detail should render at least one focused tab');
assert(det.includes('Big Ten') || det.includes('SEC'), 'detail should render a conference badge or team header');

console.log('SMOKE OK');
console.log('scoreboard length', board.length);
console.log('detail length', det.length);
process.exit(0);
