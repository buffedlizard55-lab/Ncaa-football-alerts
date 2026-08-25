// app.js
// Client-side NCAA football scoreboard. Fetches real JSON from ESPN's public
// endpoints in the browser. The app never manufactures stats/scores/plays.

import {
  CONFERENCES,
  dateParamFor,
  parseScoreboard,
  parseSummary,
  formatTime
} from './espn.js';

const CONFERENCE_ORDER = new Map(CONFERENCES.map((c, i) => [c.key, i]));

const state = {
  date: new Date(),
  selectedConferences: new Set(CONFERENCES.map((c) => c.key)),
  games: [],
  gameById: new Map(),
  selectedId: location.hash.replace('#game=', '') || '',
  summary: null,
  summaryLoading: false,
  scoreboardLoading: true,
  summaryError: '',
  scoreboardError: '',
  dataSource: '',
  lastUpdated: '',
  activeTab: 'plays',
  pbp: { scoringOnly: false, quarter: 'all' }
};

const els = {
  dateLabel: document.getElementById('date-label'),
  prevDay: document.getElementById('prev-day'),
  nextDay: document.getElementById('next-day'),
  today: document.getElementById('today'),
  datePicker: document.getElementById('date-picker'),
  refresh: document.getElementById('refresh'),
  scoreboard: document.getElementById('scoreboard'),
  detail: document.getElementById('detail'),
  status: document.getElementById('status'),
  conferenceFilters: document.getElementById('conference-filters')
};

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchJson(sources) {
  const details = [];
  let lastError = null;

  for (const source of sources) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(source.url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      clearTimeout(timer);
      if (!res.ok) {
        details.push(`${source.label}: HTTP ${res.status}`);
        lastError = new Error(`${source.label}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      const json = JSON.parse(text);
      state.dataSource = source.label;
      return { json, source: source.label };
    } catch (err) {
      details.push(`${source.label}: ${err && err.message ? err.message : String(err)}`);
      lastError = err;
    }
  }

  const err = new Error(`All data sources failed. ${details.join(' | ')}`);
  err.details = details;
  throw err;
}

function espnSources(path) {
  const primary = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/${path}`;
  const webHost = `https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/${path}`;
  return [
    { label: 'ESPN (direct)', url: primary },
    { label: 'ESPN (web host)', url: webHost },
    { label: 'local proxy', url: `/api/espn?url=${encodeURIComponent(primary)}` },
    { label: 'killcors fallback', url: `https://proxy.killcors.com/?url=${encodeURIComponent(primary)}` },
    { label: 'cors.lol fallback', url: `https://api.cors.lol/?url=${encodeURIComponent(primary)}` },
    { label: 'codetabs fallback', url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(primary)}` }
  ];
}

/* ------------------------------------------------------------------ */
/* Scoreboard                                                          */
/* ------------------------------------------------------------------ */

function filterGames() {
  return state.games
    .filter((g) => g.conferenceKeys.some((k) => state.selectedConferences.has(k)))
    .slice()
    .sort((a, b) => {
      const aConf = conferenceSortKey(a);
      const bConf = conferenceSortKey(b);
      if (aConf !== bConf) return aConf - bConf;
      return compareGames(a, b);
    });
}

function conferenceSortKey(game) {
  const k = game.primaryConferenceKey;
  const idx = CONFERENCE_ORDER.get(k);
  return idx === undefined ? 999 : idx;
}

function compareGames(a, b) {
  const order = { in: 0, pre: 1, post: 2 };
  const ao = order[a.status.state] ?? 3;
  const bo = order[b.status.state] ?? 3;
  if (ao !== bo) return ao - bo;
  const ad = new Date(a.date).getTime() || 0;
  const bd = new Date(b.date).getTime() || 0;
  if (ad !== bd) return ad - bd;
  return a.id.localeCompare(b.id);
}

function conferenceLabel(key) {
  const c = CONFERENCES.find((x) => x.key === key);
  return c ? c.label : key;
}

async function loadScoreboard(silent = false) {
  const isFirst = state.games.length === 0;
  if (!silent) {
    state.scoreboardError = '';
  }
  if (isFirst && !silent) {
    state.scoreboardLoading = true;
    state.scoreboardError = '';
    renderScoreboard();
    showStatus('Loading scoreboard…');
  }

  const param = dateParamFor(state.date);
  const path = `scoreboard?dates=${param}&limit=300`;

  try {
    const { json } = await fetchJson(espnSources(path));
    const parsed = parseScoreboard(json);
    state.games = parsed.games;
    state.gameById = new Map(state.games.map((g) => [g.id, g]));

    // If no game is selected, auto-select the first focused game.
    if (!state.selectedId || !state.gameById.has(state.selectedId)) {
      const first = filterGames()[0];
      if (first) {
        state.selectedId = first.id;
        history.replaceState(null, '', `#game=${first.id}`);
      } else {
        state.selectedId = '';
      }
    }

    state.lastUpdated = new Date().toLocaleTimeString();
    state.scoreboardLoading = false;
    state.scoreboardError = '';
    showStatus(`Updated ${state.lastUpdated}`);
    if (isFirst) {
      renderAll();
    } else {
      renderScoreboard();
      renderDetail();
    }
    // Make sure the detail panel reflects the currently selected game.
    if (state.selectedId && (!state.summary || state.summary.game.id !== state.selectedId)) {
      loadSummary(state.selectedId);
    }
  } catch (err) {
    state.scoreboardLoading = false;
    if (isFirst) {
      state.scoreboardError = err.message;
      showStatus('Scoreboard failed to load');
      renderAll();
    } else {
      showStatus(`Refresh failed: ${err.message}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

async function loadSummary(id) {
  if (!id) {
    state.summary = null;
    state.summaryLoading = false;
    state.summaryError = '';
    renderDetail();
    return;
  }

  state.summaryLoading = true;
  state.summaryError = '';
  if (!state.summary || !state.summary.game || state.summary.game.id !== id) {
    state.summary = null;
  }
  renderDetail();

  const path = `summary?event=${encodeURIComponent(id)}`;
  try {
    const { json } = await fetchJson(espnSources(path));
    state.summary = parseSummary(json);
    state.summaryLoading = false;
    renderDetail();
  } catch (err) {
    state.summaryLoading = false;
    state.summary = null;
    state.summaryError = err.message;
    renderDetail();
  }
}

function selectGame(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  history.replaceState(null, '', `#game=${id}`);
  loadSummary(id);
  renderScoreboard();
}

/* ------------------------------------------------------------------ */
/* Render: scoreboard                                                  */
/* ------------------------------------------------------------------ */

function renderAll() {
  renderDateControls();
  renderConferenceFilters();
  renderScoreboard();
  renderDetail();
}

function renderDateControls() {
  const d = state.date;
  els.dateLabel.textContent = d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  if (els.datePicker) els.datePicker.value = dateParamFor(d);
}

function renderConferenceFilters() {
  els.conferenceFilters.innerHTML = CONFERENCES.map((c) => {
    const on = state.selectedConferences.has(c.key);
    return `<label class="conf-toggle ${on ? 'selected' : ''}">
      <input type="checkbox" data-conf="${esc(c.key)}" ${on ? 'checked' : ''}>
      <span>${esc(c.label)}</span>
    </label>`;
  }).join('');

  els.conferenceFilters.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.getAttribute('data-conf');
      if (input.checked) state.selectedConferences.add(key);
      else state.selectedConferences.delete(key);
      if (state.selectedConferences.size === 0) {
        state.selectedConferences.add(key);
        input.checked = true;
      }
      renderConferenceFilters();
      renderScoreboard();
    });
  });
}

function renderScoreboard() {
  if (state.scoreboardLoading) {
    els.scoreboard.innerHTML = `<div class="empty">Loading games…</div>`;
    return;
  }
  if (state.scoreboardError) {
    els.scoreboard.innerHTML = `<div class="empty error">Could not load the scoreboard.<br><span class="mono">${esc(state.scoreboardError)}</span></div>`;
    return;
  }

  const games = filterGames();
  const grouped = groupGamesByConference(games);

  if (games.length === 0) {
    els.scoreboard.innerHTML = `<div class="empty">No focused conference games on this date.</div>`;
    return;
  }

  let html = '';
  for (const conf of CONFERENCES) {
    const list = grouped.get(conf.key) || [];
    if (!list.length) continue;
    html += `<section class="game-group">
      <h2>${esc(conf.label)} <span class="count">${list.length}</span></h2>
      <div class="game-list">${list.map(gameCard).join('')}</div>
    </section>`;
  }
  els.scoreboard.innerHTML = html;
}

function groupGamesByConference(games) {
  const map = new Map();
  for (const g of games) {
    const keys = g.conferenceKeys.length ? g.conferenceKeys : ['Other'];
    for (const key of keys) {
      if (!state.selectedConferences.has(key)) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(g);
    }
  }
  return map;
}

function statusChip(game) {
  const s = game.status;
  const cls = s.state === 'in' ? 'live' : s.state === 'post' ? 'final' : 'pre';
  return `<span class="status-chip ${cls}">${esc(s.statusText || 'Scheduled')}</span>`;
}

function gameCard(game) {
  const away = game.teams.find((t) => t.homeAway === 'away') || game.teams[0];
  const home = game.teams.find((t) => t.homeAway === 'home') || game.teams[1];
  const selected = game.id === state.selectedId ? ' selected' : '';
  const logoTag = (team) =>
    team && team.logo
      ? `<img class="team-logo" src="${esc(team.logo)}" alt="">`
      : `<span class="team-logo placeholder">${esc((team && team.abbreviation) || '?')}</span>`;

  return `<button class="game-card${selected}" data-game="${esc(game.id)}" data-tournament="false">
    <div class="game-card-head">
      ${statusChip(game)}
      <span class="game-conf">${esc(conferenceLabel(game.primaryConferenceKey))}</span>
    </div>
    <div class="game-row">
      ${logoTag(away)}
      <span class="team-name">${esc((away && away.shortDisplayName) || '—')}</span>
      <span class="score ${away && away.winner ? 'winner' : ''}">${esc((away && away.score) || '0')}</span>
    </div>
    <div class="game-row">
      ${logoTag(home)}
      <span class="team-name">${esc((home && home.shortDisplayName) || '—')}</span>
      <span class="score ${home && home.winner ? 'winner' : ''}">${esc((home && home.score) || '0')}</span>
    </div>
    <div class="game-card-foot">
      <span>${esc(formatTime(game.date))}</span>
      ${game.playByPlayAvailable ? '<span class="pbp-ok">PBP</span>' : ''}
    </div>
  </button>`;
}

/* ------------------------------------------------------------------ */
/* Render: detail                                                      */
/* ------------------------------------------------------------------ */

function renderDetail() {
  if (!state.selectedId) {
    els.detail.innerHTML = `<div class="empty">Select a game from the scoreboard.</div>`;
    return;
  }

  const gameMeta = state.gameById.get(state.selectedId);
  const summary = state.summary;
  const game = summary && summary.game ? summary.game : null;

  if (state.summaryLoading && !game) {
    els.detail.innerHTML = `<div class="empty">Loading game details…</div>`;
    return;
  }

  if (state.summaryError && !game) {
    els.detail.innerHTML = `<div class="empty error">Could not load game details.<br><span class="mono">${esc(state.summaryError)}</span></div>`;
    return;
  }

  const header = renderGameHeader(game || gameMeta, summary);
  const tabs = renderTabs();
  const body = renderTabBody(gameMeta, summary);
  els.detail.innerHTML = `${header}${tabs}<div id="tab-body">${body}</div>`;

  bindDetailEvents(gameMeta, summary);
}

function renderGameHeader(game, summary) {
  const teams = (game && game.teams) || [];
  if (!teams.length) return `<div class="detail-card empty">No header data available.</div>`;
  const status = (game && game.status) || {};
  const venue = (game && game.venue) || {};
  const venueName = venue.fullName || venue.name || '';
  const city = venue.address && venue.address.city ? `, ${venue.address.city}` : '';
  const stateAbbr = venue.address && venue.address.state ? `, ${venue.address.state}` : '';
  const broadcasts = (game && game.broadcasts) || [];
  const station = broadcasts.map((b) => (b.media && b.media.shortName) || '').filter(Boolean).join(' · ');

  const statusClass = status.state === 'in' ? 'live' : status.state === 'post' ? 'final' : 'pre';
  const logo = (t) =>
    t && t.logo
      ? `<img class="team-logo big" src="${esc(t.logo)}" alt="">`
      : `<span class="team-logo big placeholder">${esc((t && t.abbreviation) || '?')}</span>`;

  const rows = teams
    .map((t) => {
      const conf = t.conference ? `<span class="conf-badge">${esc(t.conference.label)}</span>` : '';
      const lines = Array.isArray(t.linescores) && t.linescores.length
        ? `<div class="linescores">${t.linescores
            .map((ls, i) => `<span>Q${i + 1} <b>${esc(ls.displayValue ?? ls.value ?? '0')}</b></span>`)
            .join('')}</div>`
        : '';
      const records = Array.isArray(t.records) && t.records.length
        ? `<div class="records">${t.records.map((r) => `<span>${esc(r.displayValue || r.summary || '')}</span>`).join(' · ')}</div>`
        : '';
      return `<div class="team-line">
        ${logo(t)}
        <div class="team-meta">
          <div class="team-title">${esc(t.displayName || t.shortDisplayName)} ${conf}</div>
          ${lines}
          ${records}
        </div>
        <div class="team-score ${t.winner ? 'winner' : ''}">${esc(t.score || '0')}</div>
      </div>`;
    })
    .join('');

  return `<section class="detail-card game-header">
    <div class="detail-top">
      <span class="status-chip ${statusClass}">${esc(status.statusText || status.detail || '—')}</span>
      <span class="subtle">${esc(formatTime((game && game.date) || ''))}</span>
    </div>
    <div class="team-lines">${rows}</div>
    <div class="detail-meta">
      <span>${venueName ? esc(`${venueName}${city}${stateAbbr}`) : esc('Venue unavailable')}</span>
      <span>${station ? esc(station) : esc('')}</span>
      <span>${game && game.week ? esc(`Week ${game.week}`) : ''}</span>
    </div>
  </section>`;
}

function renderTabs() {
  const tabs = [
    ['plays', 'Play-by-Play'],
    ['teamstats', 'Team Stats'],
    ['playerstats', 'Player Stats']
  ];
  return `<nav class="tabs" id="tabs">
    ${tabs.map(([k, label]) => `<button class="tab ${state.activeTab === k ? 'active' : ''}" data-tab="${k}">${esc(label)}</button>`).join('')}
  </nav>`;
}

function renderTabBody(gameMeta, summary) {
  if (state.activeTab === 'plays') return renderPlays(gameMeta, summary);
  if (state.activeTab === 'teamstats') return renderTeamStats(gameMeta, summary);
  if (state.activeTab === 'playerstats') return renderPlayerStats(gameMeta, summary);
  return '<div class="empty">No tab selected</div>';
}

/* Play-by-play */

function renderPlays(gameMeta, summary) {
  const plays = summary ? summary.plays : [];
  const gameState = (summary && summary.game && summary.game.status && summary.game.status.state) || (gameMeta && gameMeta.status.state) || '';
  const isLive = gameState === 'in';

  const quarters = buildQuarters(plays);
  const quarterKeys = Object.keys(quarters);
  if (state.pbp.quarter !== 'all' && !quarterKeys.includes(state.pbp.quarter)) {
    state.pbp.quarter = 'all';
  }
  const scoringCount = plays.filter((p) => p.isScoring).length;

  return `<div class="pbp-wrap">
    <div class="pbp-controls" id="pbp-controls">
      <label class="chk"><input type="checkbox" id="pbp-scoring" ${state.pbp.scoringOnly ? 'checked' : ''}> Scoring plays only</label>
      <select id="pbp-quarter">
        <option value="all">All quarters</option>
        ${Object.keys(quarters).map((q) => `<option value="${esc(q)}" ${state.pbp.quarter === q ? 'selected' : ''}>${esc(periodLabel(q))}</option>`).join('')}
      </select>
      <span class="subtle">${plays.length} plays${isLive ? ' · live' : ''}</span>
    </div>
    ${plays.length === 0 ? `<div class="empty">No play-by-play available yet. ${isLive ? 'Auto-refreshing…' : ''}</div>` : ''}
    ${scoringCount ? `<div class="scoring-summary">${scoringCount} scoring play${scoringCount === 1 ? '' : 's'}</div>` : ''}
    ${renderQuarterSections(quarters)}
  </div>`;
}

function buildQuarters(plays) {
  const map = {};
  for (const p of plays) {
    const key = p.period != null ? String(p.period) : 'pre';
    if (!map[key]) map[key] = [];
    map[key].push(p);
  }
  for (const key of Object.keys(map)) map[key].sort(comparePlays);
  return map;
}

function comparePlays(a, b) {
  if (a.sequenceNumber !== b.sequenceNumber) return a.sequenceNumber - b.sequenceNumber;
  return a.id.localeCompare(b.id);
}

function periodLabel(key) {
  if (key === 'pre') return 'Pre-game';
  const n = Number(key);
  if (n === 5) return 'Overtime';
  const suffix = ['st', 'nd', 'rd'];
  if (n >= 1 && n <= 3) return `${n}${suffix[n - 1]} Quarter`;
  return `${n}th Quarter`;
}

function renderQuarterSections(quarters) {
  const entries = Object.entries(quarters).filter(
    ([q]) => state.pbp.quarter === 'all' || q === state.pbp.quarter
  );
  if (!entries.length) return '';
  return entries
    .map(([q, list]) => {
      const filtered = state.pbp.scoringOnly ? list.filter((p) => p.isScoring) : list;
      if (!filtered.length) return '';
      return `<section class="quarter-block">
        <h3>${esc(periodLabel(q))}</h3>
        <div class="play-list">${filtered.map(renderPlay).join('')}</div>
      </section>`;
    })
    .join('');
}

function renderPlay(play) {
  const team = gameTeamAbbr(state, play.offenseTeamId);
  const start = play.startDownDistance || '';
  const scoring = play.isScoring ? ' scoring' : '';
  const priority = play.priority ? ' priority' : '';
  const scoreAfter = play.awayScore != null && play.homeScore != null
    ? `${play.awayScore}-${play.homeScore}`
    : '';
  const clock = play.clock || '';
  const typeTag = play.abbreviation || play.type || '';

  return `<div class="play${scoring}${priority}" data-play="${esc(play.id)}">
    <div class="play-meta">
      <span class="clock">${esc(clock)}</span>
      <span class="team">${esc(team || '')}</span>
      <span class="down">${esc(start)}</span>
    </div>
    <div class="play-main">
      <div class="play-text">${esc(play.text)}</div>
      <div class="play-tags">
        ${play.isScoring ? '<span class="tag tag-score">SCORE</span>' : ''}
        ${play.isPenalty ? '<span class="tag">PEN</span>' : ''}
        ${play.isTurnover ? '<span class="tag tag-turn">TO</span>' : ''}
        ${typeTag ? `<span class="tag">${esc(typeTag)}</span>` : ''}
        ${scoreAfter ? `<span class="tag tag-score">${esc(scoreAfter)}</span>` : ''}
      </div>
    </div>
  </div>`;
}

/* Team stats */

function renderTeamStats(gameMeta, summary) {
  const teams = summary ? summary.boxscoreTeams : [];
  if (!teams.length) return `<div class="empty">No team statistics available.</div>`;
  const away = teams.find((t) => t.homeAway === 'away') || teams[0];
  const home = teams.find((t) => t.homeAway === 'home') || teams[1] || away;

  const statMap = (team) => new Map((team.statistics || []).map((s) => [s.name, s]));
  const awayMap = statMap(away);
  const homeMap = statMap(home);
  const names = [...new Set([...awayMap.keys(), ...homeMap.keys()])];

  const rows = names.map((name) => {
    const hr = homeMap.get(name) || {};
    const ar = awayMap.get(name) || {};
    const label = hr.label || ar.label || name;
    return `<tr><td class="stat-label">${esc(label)}</td><td>${esc(ar.displayValue || '')}</td><td>${esc(hr.displayValue || '')}</td></tr>`;
  });

  return `<section class="detail-card">
    <table class="stat-table">
      <thead>
        <tr>
          <th>Team Stats</th>
          <th>${esc(away.team.shortDisplayName || away.team.displayName || 'Away')}</th>
          <th>${esc(home.team.shortDisplayName || home.team.displayName || 'Home')}</th>
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  </section>`;
}

/* Player stats */

function renderPlayerStats(gameMeta, summary) {
  const players = summary ? summary.boxscorePlayers : [];
  if (!players.length) return `<div class="empty">No player statistics available.</div>`;

  const html = players
    .map((teamBlock) => {
      const teamName = teamBlock.team.displayName || teamBlock.team.shortDisplayName || 'Team';
      const sections = teamBlock.statistics
        .map((cat) => renderPlayerCategory(teamBlock, cat))
        .filter(Boolean)
        .join('');
      return `<section class="detail-card player-team">
        <h3>${esc(teamName)}</h3>
        ${sections || '<div class="empty">No stat categories.</div>'}
      </section>`;
    })
    .join('');

  return html;
}

function renderPlayerCategory(teamBlock, cat) {
  const labels = Array.isArray(cat.labels) ? cat.labels : [];
  const athletes = Array.isArray(cat.athletes) ? cat.athletes : [];
  const totals = Array.isArray(cat.totals) ? cat.totals : [];
  if (!labels.length && !athletes.length) return '';

  const rows = athletes.map((entry) => {
    const athlete = entry.athlete || {};
    const stats = Array.isArray(entry.stats) ? entry.stats : [];
    const cells = labels.map((_, i) => `<td>${esc(stats[i] || '—')}</td>`).join('');
    return `<tr>
      <td class="athlete">${esc(athlete.displayName || '')} ${athlete.jersey ? `<span class="jersey">#${esc(athlete.jersey)}</span>` : ''}</td>
      ${cells}
    </tr>`;
  }).join('');

  const totalRow = totals.length
    ? `<tr class="total-row"><td>Totals</td>${labels.map((_, i) => `<td>${esc(totals[i] || '—')}</td>`).join('')}</tr>`
    : '';

  const header = labels.map((l) => `<th>${esc(l)}</th>`).join('');

  return `<div class="player-cat">
    <h4>${esc(cat.text || cat.name || '')}</h4>
    <div class="table-scroll">
      <table class="stat-table player-table">
        <thead><tr><th>Player</th>${header}</tr></thead>
        <tbody>${rows}${totalRow}</tbody>
      </table>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function gameTeamAbbr(state_, teamId) {
  const game = state_.gameById.get(state_.selectedId);
  if (!game) return '';
  const t = game.teams.find((x) => x.id === teamId);
  if (t) return t.abbreviation;
  if (state_.summary && state_.summary.game) {
    const h = state_.summary.game.teams.find((x) => x.id === teamId);
    if (h) return h.abbreviation;
  }
  return '';
}

function showStatus(text) {
  els.status.textContent = text;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function bindDetailEvents(gameMeta, summary) {
  const tabsRoot = document.getElementById('tabs');
  if (tabsRoot) {
    tabsRoot.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeTab = btn.getAttribute('data-tab');
        renderDetail();
      });
    });
  }

  const pbpScoring = document.getElementById('pbp-scoring');
  if (pbpScoring) {
    pbpScoring.addEventListener('change', () => {
      state.pbp.scoringOnly = pbpScoring.checked;
      renderDetail();
    });
  }
  const pbpQuarter = document.getElementById('pbp-quarter');
  if (pbpQuarter) {
    pbpQuarter.addEventListener('change', () => {
      state.pbp.quarter = pbpQuarter.value;
      renderDetail();
    });
  }
  if (!pbpQuarter && !pbpScoring) return;
}

function bindScoreboardClicks() {
  els.scoreboard.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-game]');
    if (btn) selectGame(btn.getAttribute('data-game'));
  });
}

function setDate(offset) {
  const d = new Date(state.date);
  d.setDate(d.getDate() + offset);
  state.date = d;
  loadScoreboard();
}

function init() {
  renderConferenceFilters();
  renderDateControls();
  els.prevDay.addEventListener('click', () => setDate(-1));
  els.nextDay.addEventListener('click', () => setDate(1));
  els.today.addEventListener('click', () => {
    state.date = new Date();
    loadScoreboard();
  });
  els.datePicker.addEventListener('change', () => {
    const val = els.datePicker.value;
    if (/^\d{8}$/.test(val)) {
      state.date = new Date(`${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}T12:00:00`);
      loadScoreboard();
    }
  });
  els.refresh.addEventListener('click', () => {
    loadScoreboard();
    if (state.selectedId) loadSummary(state.selectedId);
  });
  window.addEventListener('hashchange', () => {
    const id = location.hash.replace('#game=', '');
    if (id && id !== state.selectedId) selectGame(id);
  });
  bindScoreboardClicks();
  loadScoreboard();
  if (state.selectedId) loadSummary(state.selectedId);

  // Auto-refresh live game + scoreboard. Clear on page unload not needed for a client app.
  setInterval(() => {
    if (state.summary && state.summary.game && state.summary.game.status && state.summary.game.status.state === 'in') {
      if (state.selectedId) loadSummary(state.selectedId);
    }
    loadScoreboard(true);
  }, 60000);
}

init();
