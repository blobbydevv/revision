/* Revise NI — app logic. Depends on assets/data.js (S, M, YEARS). */
(function () {
'use strict';

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = t => String(t).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const DAY = 864e5;
const today = () => Math.floor(Date.now() / DAY);
const INTERVALS = [0, 1, 2, 4, 8, 16];

/* ---------------- flattened card index ---------------- */
const ALL = [];
S.forEach(s => s.topics.forEach(t => t.cards.forEach((c, i) => {
  ALL.push({ k: `${s.id}:${t.id}:${i}`, s, t, q: c[0], a: c[1] });
})));
const subjectCards = s => ALL.filter(c => c.s === s);
const topicCards = (s, t) => ALL.filter(c => c.s === s && c.t === t);
const TOTAL_CARDS = ALL.length;

/* ---------------- accounts (browser-local) ---------------- */
/* Passwords are PBKDF2-hashed with a per-user salt. This keeps a password out of
   storage in plain text, but it is NOT server-side security: anyone with access to
   this browser's storage can clear or inspect the profile list. The UI says so. */
const readJSON = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
};
const writeJSON = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} };

const users = () => readJSON('rni-users', {});
const saveUsers = u => writeJSON('rni-users', u);

const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randomSalt = () => toHex(crypto.getRandomValues(new Uint8Array(16)));

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  if (crypto.subtle && crypto.subtle.importKey) {
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
    return 'pbkdf2$' + toHex(bits);
  }
  // Fallback for insecure contexts (e.g. opened as a file://). Weaker, and flagged as such.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const str = salt + '\u0000' + password;
  for (let i = 0; i < str.length; i++) {
    h1 = Math.imul(h1 ^ str.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + str.charCodeAt(i) * (i + 1), 2246822519) >>> 0;
  }
  return 'weak$' + h1.toString(16) + h2.toString(16);
}

let currentUser = null;              // username string, or null for guest
const sessionKey = 'rni-session';
const progressKey = () => currentUser ? 'rni-p-' + currentUser : 'rni';

/* ---------------- progress ---------------- */
let P = { c: {}, days: [], quiz: {} };
function loadProgress() {
  P = readJSON(progressKey(), {});
  P.c = P.c || {};
  P.days = P.days || [];
  P.quiz = P.quiz || {};
}
const save = () => writeJSON(progressKey(), P);

const state = k => P.c[k] || { b: 0, d: 0 };
const isDue = card => state(card.k).d <= today();

function rateCard(card, score) {
  let box = state(card.k).b;
  if (score === 3) box = Math.min(5, box + 1);
  else if (score === 1) box = 1;
  else box = Math.max(1, box);
  P.c[card.k] = { b: box, d: today() + (score === 1 ? 0 : score === 2 ? 1 : INTERVALS[box]) };
  const t = today();
  if (!P.days.includes(t)) P.days.push(t);
  save();
  refreshStats();
}

function streak() {
  const seen = new Set(P.days);
  let n = 0, t = today();
  if (!seen.has(t)) t--;
  while (seen.has(t)) { n++; t--; }
  return n;
}

const profile = () => currentUser ? (users()[currentUser] || {}) : readJSON('rni-guest-profile', {});
function saveProfile(patch) {
  if (currentUser) {
    const all = users();
    all[currentUser] = Object.assign({}, all[currentUser], patch);
    saveUsers(all);
  } else {
    writeJSON('rni-guest-profile', Object.assign({}, profile(), patch));
  }
}
const mySubjects = () => {
  const ids = profile().subjects;
  if (!ids || !ids.length) return [];
  return S.filter(s => ids.includes(s.id));
};

/* ---------------- theme ---------------- */
const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
const isDark = () => document.documentElement.dataset.theme
  ? document.documentElement.dataset.theme === 'dark' : prefersDark();
const syncThemeIcons = () => {
  $('.icon-btn__sun').style.display = isDark() ? 'none' : 'block';
  $('.icon-btn__moon').style.display = isDark() ? 'block' : 'none';
};
$('#themeToggle').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('rni-theme', next); } catch (e) {}
  syncThemeIcons();
});
syncThemeIcons();

/* ---------------- deck engine ---------------- */
function Deck(cardEl, rateEl, getQueue, opts = {}) {
  let queue = [], current = null;

  function render() {
    current = queue[0];
    cardEl.classList.remove('is-flipped');
    if (!current) {
      cardEl.innerHTML = `
        <div class="flashcard__face" style="--subject:var(--ok)">
          <div class="flashcard__meta"><span class="flashcard__subject"><i class="flashcard__dot"></i>All done</span></div>
          <p class="flashcard__prompt">Nothing due here right now. Come back tomorrow, or run the whole deck again for extra practice.</p>
          <div><button class="btn btn--ghost btn--sm" data-deck-reset>Practise all again</button></div>
        </div>`;
      rateEl.innerHTML = '';
      opts.onEmpty && opts.onEmpty();
      return;
    }
    const box = state(current.k).b;
    cardEl.innerHTML = `
      <div class="flashcard__face" style="--subject:${esc(current.s.c)}">
        <div class="flashcard__meta">
          <span class="flashcard__subject"><i class="flashcard__dot"></i>${esc(current.s.n)} · ${esc(current.t.n)}</span>
          <span>${box ? 'Box ' + box : 'New card'}</span>
        </div>
        <p class="flashcard__prompt">${esc(current.q)}</p>
        <p class="flashcard__hint">Say your answer out loud, then tap the card or press Space</p>
      </div>
      <div class="flashcard__face flashcard__face--back" style="--subject:${esc(current.s.c)}">
        <div class="flashcard__meta"><span class="flashcard__subject"><i class="flashcard__dot"></i>Answer</span><span>${queue.length} left</span></div>
        <p class="flashcard__prompt flashcard__prompt--answer">${esc(current.a)}</p>
        <p class="flashcard__hint">Be honest — rating it hard now saves you marks later.</p>
      </div>`;
    rateEl.innerHTML = `
      <button class="rate--1" data-rate="1" disabled>Forgot</button>
      <button class="rate--2" data-rate="2" disabled>Shaky</button>
      <button class="rate--3" data-rate="3" disabled>Got it</button>`;
    opts.onDraw && opts.onDraw(queue.length);
  }
  function flip() {
    if (!current) return;
    cardEl.classList.toggle('is-flipped');
    $$('button', rateEl).forEach(b => { b.disabled = false; });
  }
  function doRate(score) {
    if (!current || !cardEl.classList.contains('is-flipped')) return;
    rateCard(current, score);
    queue.shift();
    if (score === 1) queue.splice(Math.min(3, queue.length), 0, current);
    render();
  }
  cardEl.addEventListener('click', e => {
    if (e.target.closest('[data-deck-reset]')) { queue = shuffle(getQueue(true)); render(); return; }
    flip();
  });
  rateEl.addEventListener('click', e => {
    const b = e.target.closest('[data-rate]');
    if (b) doRate(+b.dataset.rate);
  });
  return { load() { queue = shuffle(getQueue(false)); render(); }, flip, doRate, left: () => queue.length };
}

/* pool used by the hero and mixed decks: the user's subjects if chosen, else everything */
const activePool = () => { const m = mySubjects(); return m.length ? ALL.filter(c => m.includes(c.s)) : ALL; };

const heroDeck = Deck($('#heroCard'), $('#heroRate'), all => {
  const pool = activePool(), due = pool.filter(isDue);
  return all || !due.length ? pool.slice() : due;
});
const mixDeck = Deck($('#mixCard'), $('#mixRate'), all => {
  const pool = activePool();
  return all ? pool.slice() : pool.filter(isDue);
}, {
  onDraw: left => { $('#mixLeft').textContent = left + ' card' + (left === 1 ? '' : 's') + ' left in this session'; },
  onEmpty: () => { $('#mixLeft').textContent = ''; }
});
let subjectDeck = null, activeSubject = null, activeTopic = null;

document.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const deck =
    $('#view-mixed').classList.contains('is-active') ? mixDeck :
    $('#view-home').classList.contains('is-active') ? heroDeck :
    ($('#view-subject').classList.contains('is-active') && subjectDeck) ? subjectDeck : null;
  if (!deck) return;
  if (e.code === 'Space') { e.preventDefault(); deck.flip(); }
  else if (['1', '2', '3'].includes(e.key)) deck.doRate(+e.key);
});

/* ---------------- stats + grids ---------------- */
function refreshStats() {
  const pool = activePool();
  const due = pool.filter(isDue).length;
  const mastered = pool.filter(c => state(c.k).b >= 5).length;
  const str = streak();
  const set = (sel, val) => { const el = $(sel); if (el) el.textContent = val; };

  set('#statSubjects', S.length);
  set('#statCards', TOTAL_CARDS);
  set('#statDue', due);
  set('#statStreak', str);
  set('#appDue', due);
  set('#appMastered', mastered);
  set('#appStreak', str);
  set('#heroCount', `${S.length} subjects · ${TOTAL_CARDS} cards`);

  const exam = profile().exam || '2027-05-10';
  if ($('#examDate')) $('#examDate').value = exam;
  const days = Math.ceil((new Date(exam) - Date.now()) / DAY);
  set('#appDays', days > 0 ? days : '0');

  const hour = new Date().getHours();
  const who = currentUser ? ', ' + currentUser : '';
  set('#greeting', (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening') + who +
    (due ? ` — ${due} card${due === 1 ? '' : 's'} due` : ' — nothing due, nice work'));

  renderSubjectGrids();
  renderAccountButton();
}

$('#examDate').addEventListener('change', e => { saveProfile({ exam: e.target.value }); refreshStats(); });

function subjectCardHTML(s) {
  const cards = subjectCards(s);
  const known = cards.filter(c => state(c.k).b >= 3).length;
  const due = cards.filter(isDue).length;
  return `
    <button class="subject" data-subject="${s.id}" style="--subject:${esc(s.c)}">
      <span class="subject__mark">${esc(s.m)}</span>
      <span class="subject__name">${esc(s.n)}</span>
      <span class="subject__meta">${cards.length} cards · ${s.topics.length} topics · ${due} due</span>
      <span class="subject__bar"><i style="width:${Math.round(known / cards.length * 100)}%"></i></span>
    </button>`;
}

function renderSubjectGrids() {
  const mine = mySubjects();
  const wrap = $('#mySubjectsWrap');
  if (wrap) {
    wrap.hidden = !mine.length;
    if (mine.length) $('#mySubjectGrid').innerHTML = mine.map(subjectCardHTML).join('');
  }
  if ($('#allSubjectsHeading')) $('#allSubjectsHeading').textContent = mine.length ? 'Every CCEA subject' : 'All subjects';
  if ($('#subjectGrid')) $('#subjectGrid').innerHTML = S.map(subjectCardHTML).join('');
}

$('#subjectChips').innerHTML = S.map(s => `<span>${esc(s.n)}</span>`).join('');

/* ---------------- search ---------------- */
$('#searchInput').addEventListener('input', e => {
  const term = e.target.value.trim().toLowerCase();
  const results = $('#searchResults');
  $$('#subjectGrid .subject').forEach(btn => {
    const s = S.find(x => x.id === btn.dataset.subject);
    btn.style.display = !term || s.n.toLowerCase().includes(term) ? '' : 'none';
  });
  if (term.length < 3) { results.style.display = 'none'; return; }
  const hits = ALL.filter(c => (c.q + ' ' + c.a).toLowerCase().includes(term)).slice(0, 14);
  results.style.display = hits.length ? '' : 'none';
  results.innerHTML = `<h3>Matching cards</h3><div class="cardlist">` + hits.map(c =>
    `<div class="cardlist__row"><b>${esc(c.q)}</b><span>${esc(c.a)}</span><span class="cardlist__box">${esc(c.s.m)}</span></div>`
  ).join('') + `</div>`;
});

/* ---------------- methods ---------------- */
const methodHTML = (m, i) => `
  <div class="method">
    <div class="method__rank">${String(i + 1).padStart(2, '0')}</div>
    <div>
      <div class="method__head">
        <h3>${esc(m.n)}</h3>
        <span class="pill pill--${esc(m.u)}">${m.u === 'Promising' ? 'Promising' : esc(m.u) + ' utility'}</span>
      </div>
      <p>${esc(m.why)}</p>
      <details><summary>How to do it</summary><ul>${m.how.map(h => `<li>${esc(h)}</li>`).join('')}</ul></details>
    </div>
    ${m.go ? `<button class="btn btn--ghost btn--sm method__cta" data-try="${esc(m.go)}">Try it</button>` : '<span></span>'}
  </div>`;
$('#methodsFull').innerHTML = M.map(methodHTML).join('');
$('#methodsPreview').innerHTML = M.slice(0, 3).map(methodHTML).join('');

/* ---------------- quizzes ---------------- */
const quizKey = (s, t) => t ? `${s.id}:${t.id}` : s.id;
const quizRecord = key => P.quiz[key] || { best: 0, attempts: 0, outOf: 0 };
function recordQuiz(key, score, outOf) {
  const prev = quizRecord(key);
  P.quiz[key] = { best: Math.max(prev.best, score), attempts: prev.attempts + 1, outOf, last: score };
  const t = today();
  if (!P.days.includes(t)) P.days.push(t);
  save();
}

/* Builds a quiz: `pool` are the candidate cards, `distractorPool` supplies wrong answers. */
function runQuiz(mount, { pool, distractorPool, length, key, title, subtitle, onExit }) {
  const questions = shuffle(pool).slice(0, Math.min(length, pool.length));
  let i = 0, score = 0;
  const wrong = [];

  function show() {
    if (i >= questions.length) {
      recordQuiz(key, score, questions.length);
      const pct = Math.round(score / questions.length * 100);
      const verdict = pct === 100 ? 'Perfect round.' : pct >= 80 ? 'Strong — a couple to tidy up.'
        : pct >= 50 ? 'Getting there. The misses are back in box 1.' : 'Worth a flashcard session before trying again.';
      mount.innerHTML = `
        <div class="card card--pad quiz" style="max-width:720px">
          <span class="eyebrow">${esc(title)} complete</span>
          <h2 style="margin-top:1rem">${score} / ${questions.length}</h2>
          <div class="progress" style="margin-top:1rem"><i style="width:${pct}%"></i></div>
          <p class="u-muted" style="margin-top:.75rem">${verdict} Best score for this quiz: <b>${quizRecord(key).best}/${questions.length}</b>.</p>
          ${wrong.length ? `<div class="quiz-review"><h3>Review these</h3>${wrong.map(c =>
            `<div class="cardlist__row"><b>${esc(c.q)}</b><span>${esc(c.a)}</span><span class="cardlist__box">${esc(c.t.n)}</span></div>`).join('')}</div>` : ''}
          <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.5rem">
            <button class="btn btn--primary" data-quiz-again>Try again</button>
            <button class="btn btn--ghost" data-quiz-exit>Back</button>
          </div>
        </div>`;
      $('[data-quiz-again]', mount).onclick = () => runQuiz(mount, { pool, distractorPool, length, key, title, subtitle, onExit });
      $('[data-quiz-exit]', mount).onclick = onExit;
      refreshStats();
      return;
    }

    const card = questions[i];
    const others = shuffle(distractorPool.filter(x => x !== card && x.a !== card.a)).slice(0, 3);
    const options = shuffle([card, ...others]);
    mount.innerHTML = `
      <div class="card card--pad quiz" style="max-width:780px">
        <div class="quiz__head">
          <div>
            <span class="eyebrow eyebrow--plain">${esc(title)}</span>
            <p class="u-muted" style="font-size:.85rem;margin-top:.35rem">Question ${i + 1} of ${questions.length} · Score ${score}${subtitle ? ' · ' + esc(subtitle) : ''}</p>
          </div>
          <button class="btn btn--quiet btn--sm" data-quiz-exit>Quit</button>
        </div>
        <div class="progress"><i style="width:${i / questions.length * 100}%"></i></div>
        <h3 style="font-size:1.22rem;line-height:1.35">${esc(card.q)}</h3>
        <div style="margin-top:.5rem">${options.map((o, j) => `<button class="option" data-option="${j}">${esc(o.a)}</button>`).join('')}</div>
      </div>`;
    $('[data-quiz-exit]', mount).onclick = onExit;
    $$('.option', mount).forEach((btn, j) => {
      btn.onclick = () => {
        if ($('.option.is-correct', mount)) return;
        const correct = options[j] === card;
        if (correct) score++;
        else { P.c[card.k] = { b: 1, d: today() }; wrong.push(card); save(); }
        $$('.option', mount).forEach((el, k) => {
          if (options[k] === card) el.classList.add('is-correct');
          else if (k === j) el.classList.add('is-wrong');
        });
        setTimeout(() => { i++; show(); }, correct ? 650 : 1700);
      };
    });
  }
  show();
}

/* ---------------- subject view ---------------- */
const TABS = [['topics', 'Topics'], ['cards', 'Flashcards'], ['quiz', 'Subject quiz'], ['blurt', 'Blurt'], ['list', 'All cards']];

function openSubject(id, tab = 'topics') {
  activeSubject = S.find(s => s.id === id);
  if (!activeSubject) { navigate('app'); return; }
  activeTopic = null;
  const cards = subjectCards(activeSubject);
  const mastered = cards.filter(c => state(c.k).b >= 5).length;
  const head = $('#subjectHead');
  head.style.setProperty('--subject', activeSubject.c);
  head.innerHTML = `
    <div class="u-shell subject-head__inner">
      <button class="backlink" data-route="app">← All subjects</button>
      <div>
        <h1>${esc(activeSubject.n)}</h1>
        <p>CCEA GCSE · ${cards.length} cards · ${activeSubject.topics.length} topics · ${mastered} mastered</p>
      </div>
    </div>`;
  $('#subjectTabs').innerHTML = TABS.map(([k, label]) =>
    `<button class="tab${k === tab ? ' is-active' : ''}" data-tab="${k}">${label}</button>`).join('');
  PANELS[tab]();
}

function setTab(name) {
  $$('.tab', $('#subjectTabs')).forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
  PANELS[name]();
}

const PANELS = {
  /* Topic hub: per-topic progress, mini quiz and topic-only flashcards */
  topics() {
    subjectDeck = null; activeTopic = null;
    const rows = activeSubject.topics.map(t => {
      const cards = topicCards(activeSubject, t);
      const known = cards.filter(c => state(c.k).b >= 3).length;
      const due = cards.filter(isDue).length;
      const q = quizRecord(quizKey(activeSubject, t));
      const pct = Math.round(known / cards.length * 100);
      return `
        <div class="topic">
          <div class="topic__main">
            <h3>${esc(t.n)}</h3>
            <p class="topic__meta">${cards.length} cards · ${due} due${q.attempts ? ` · best quiz ${q.best}/${q.outOf}` : ''}</p>
            <div class="topic__bar"><i style="width:${pct}%"></i></div>
          </div>
          <div class="topic__actions">
            <button class="btn btn--ghost btn--sm" data-topic-cards="${esc(t.id)}">Cards</button>
            <button class="btn btn--primary btn--sm" data-topic-quiz="${esc(t.id)}">Quiz</button>
          </div>
        </div>`;
    }).join('');

    $('#subjectBody').innerHTML = `
      <div class="split">
        <div>
          <div class="section-head" style="margin-bottom:1rem">
            <h2 style="font-size:1.3rem">Topics in ${esc(activeSubject.n)}</h2>
          </div>
          <div class="topics">${rows}</div>
        </div>
        <div class="card card--pad">
          <h3>Two kinds of quiz</h3>
          <p class="u-muted" style="margin-top:.6rem;font-size:.93rem"><b>Topic quiz</b> — a short round on one topic. Use it right after you've studied that topic.</p>
          <p class="u-muted" style="margin-top:.6rem;font-size:.93rem"><b>Subject quiz</b> — a longer round mixing every topic. Use it closer to the exam, when you need to pick the right knowledge without a hint.</p>
          <hr style="border:0;border-top:1px solid var(--line);margin:1.1rem 0">
          <p class="u-muted" style="font-size:.93rem">Wrong answers are sent back to box 1 in your flashcards automatically, so the gaps come round again tomorrow.</p>
          <button class="btn btn--primary" style="margin-top:1.1rem;width:100%" data-tab="quiz">Full subject quiz</button>
        </div>
      </div>`;

    $$('[data-topic-cards]').forEach(b => b.onclick = () => {
      activeTopic = activeSubject.topics.find(t => t.id === b.dataset.topicCards);
      setTab('cards');
    });
    $$('[data-topic-quiz]').forEach(b => b.onclick = () => {
      const topic = activeSubject.topics.find(t => t.id === b.dataset.topicQuiz);
      const pool = topicCards(activeSubject, topic);
      runQuiz($('#subjectBody'), {
        pool, distractorPool: subjectCards(activeSubject), length: 6,
        key: quizKey(activeSubject, topic), title: topic.n + ' quiz', subtitle: activeSubject.n,
        onExit: () => setTab('topics')
      });
    });
  },

  cards() {
    const scoped = activeTopic ? topicCards(activeSubject, activeTopic) : subjectCards(activeSubject);
    $('#subjectBody').innerHTML = `
      <div class="split">
        <div>
          ${activeTopic ? `<div class="scope-note">Showing <b>${esc(activeTopic.n)}</b> only · <button class="linkish" id="clearTopic">use the whole subject</button></div>` : ''}
          <div class="deck"><div class="flashcard" id="subjectCard"></div></div>
          <div class="deck-rate" id="subjectRate"></div>
        </div>
        <div class="card card--pad">
          <h3>Study one topic at a time</h3>
          <p class="u-muted" style="margin-top:.6rem;font-size:.93rem">Pick a single topic from the Topics tab to drill it, then come back to the whole subject once each topic feels solid.</p>
          <p class="u-muted" style="margin-top:.75rem;font-size:.93rem">Keys: <b>Space</b> flip · <b>1</b> forgot · <b>2</b> shaky · <b>3</b> got it</p>
          <p class="u-muted" style="margin-top:.75rem;font-size:.93rem">${scoped.length} cards in scope · ${scoped.filter(isDue).length} due now</p>
        </div>
      </div>`;
    if (activeTopic) $('#clearTopic').onclick = () => { activeTopic = null; setTab('cards'); };
    subjectDeck = Deck($('#subjectCard'), $('#subjectRate'), all => {
      const due = scoped.filter(isDue);
      return all || !due.length ? scoped.slice() : due;
    });
    subjectDeck.load();
  },

  quiz() {
    subjectDeck = null;
    const pool = subjectCards(activeSubject);
    runQuiz($('#subjectBody'), {
      pool, distractorPool: pool, length: 15,
      key: quizKey(activeSubject, null), title: activeSubject.n + ' subject quiz',
      subtitle: 'all topics mixed', onExit: () => setTab('topics')
    });
  },

  blurt() {
    subjectDeck = null; 
    $('#subjectBody').innerHTML = `
      <div class="split">
        <div class="card card--pad">
          <label class="field-label" for="blurtTopic">Topic</label>
          <select id="blurtTopic" class="field" style="margin:.5rem 0 1rem">${activeSubject.topics.map(t => `<option value="${esc(t.id)}">${esc(t.n)}</option>`).join('')}</select>
          <textarea id="blurtText" placeholder="Write everything you remember about this topic. No notes. Don't stop to check."></textarea>
          <div style="display:flex;gap:.75rem;margin-top:.9rem;flex-wrap:wrap;align-items:center">
            <button class="btn btn--primary" id="blurtStart">Start 7-minute blurt</button>
            <button class="btn btn--ghost" id="blurtCheck">Check against key points</button>
            <b class="countdown" id="blurtClock"></b>
          </div>
        </div>
        <div class="card card--pad" id="blurtResult">
          <h3>How blurting works</h3>
          <ol class="u-muted" style="margin:.75rem 0 0;padding-left:1.15rem;font-size:.93rem;line-height:1.8">
            <li>Pick a topic and start the clock.</li>
            <li>Write everything you can remember, from memory only.</li>
            <li>Check against that topic's key points and tick what you got.</li>
            <li>Send the gaps to your flashcards and blurt again in a few days.</li>
          </ol>
        </div>`;
    const draftKey = () => 'rni-blurt-' + (currentUser || 'guest') + '-' + activeSubject.id;
    try { $('#blurtText').value = localStorage.getItem(draftKey()) || ''; } catch (e) {}
    $('#blurtText').oninput = e => { try { localStorage.setItem(draftKey(), e.target.value); } catch (x) {} };

    let ticker = null;
    $('#blurtStart').onclick = () => {
      clearInterval(ticker);
      let left = 420;
      $('#blurtText').focus();
      const tick = () => {
        $('#blurtClock').textContent = `${left / 60 | 0}:${String(left % 60).padStart(2, '0')}`;
        if (left <= 0) { clearInterval(ticker); $('#blurtClock').textContent = "Time's up"; return; }
        left--;
      };
      tick(); ticker = setInterval(tick, 1000);
    };
    $('#blurtCheck').onclick = () => {
      const text = $('#blurtText').value.toLowerCase();
      const topic = activeSubject.topics.find(t => t.id === $('#blurtTopic').value);
      const cards = topicCards(activeSubject, topic);
      $('#blurtResult').innerHTML = `<h3>${esc(topic.n)} — tick what you included</h3>` +
        cards.map(c => {
          const words = c.a.toLowerCase().match(/[a-z]{5,}/g) || [];
          const hit = words.length && words.filter(w => text.includes(w)).length / words.length > 0.3;
          return `<label class="check"><input type="checkbox" ${hit ? 'checked' : ''} data-card="${esc(c.k)}">
            <span><b>${esc(c.q)}</b><br><span class="u-muted">${esc(c.a)}</span></span></label>`;
        }).join('') +
        `<button class="btn btn--primary" id="blurtSave" style="margin-top:1rem">Send unticked to flashcards</button>`;
      $('#blurtSave').onclick = () => {
        $$('#blurtResult input').forEach(input => { if (!input.checked) P.c[input.dataset.card] = { b: 1, d: today() }; });
        save(); refreshStats();
        $('#blurtSave').textContent = 'Done — gaps queued for today';
        $('#blurtSave').disabled = true;
      };
    };
  },

  list() {
    subjectDeck = null;
    $('#subjectBody').innerHTML = activeSubject.topics.map(t => `
      <div class="card card--pad" style="margin-bottom:1.25rem">
        <h3>${esc(t.n)} <span class="u-muted" style="font-weight:400;font-size:.85rem">· ${topicCards(activeSubject, t).length} cards</span></h3>
        <div class="cardlist" style="margin-top:.75rem">${topicCards(activeSubject, t).map(c => {
          const b = state(c.k).b;
          return `<div class="cardlist__row"><b>${esc(c.q)}</b><span>${esc(c.a)}</span><span class="cardlist__box">${b ? 'Box ' + b : 'New'}</span></div>`;
        }).join('')}</div>
      </div>`).join('');
  }
};

$('#subjectTabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-tab]');
  if (btn) { activeTopic = null; setTab(btn.dataset.tab); }
});
$('#subjectBody').addEventListener('click', e => {
  const btn = e.target.closest('[data-tab]');
  if (btn) setTab(btn.dataset.tab);
});

/* ---------------- focus timer ---------------- */
const PRESETS = [['Pomodoro', 25, 5], ['Deep work', 50, 10], ['Quick', 15, 3]];
let focusMin = 25, breakMin = 5, secondsLeft = 25 * 60, ticking = null, onBreak = false, blocksDone = 0;
$('#timerPresets').innerHTML = PRESETS.map((p, i) =>
  `<button class="tab${i ? '' : ' is-active'}" data-preset="${i}">${p[0]} · ${p[1]}/${p[2]}</button>`).join('');
function drawTimer() {
  $('#timerTime').textContent =
    `${String(secondsLeft / 60 | 0).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;
  const total = (onBreak ? breakMin : focusMin) * 60;
  $('#timerArc').style.strokeDashoffset = 326.7 * (1 - secondsLeft / total);
  $('#timerArc').style.stroke = onBreak ? 'var(--ok)' : 'var(--brand)';
  $('#timerMode').textContent = onBreak ? 'Break' : 'Focus';
  $('#timerCount').textContent = `Focus blocks finished this session: ${blocksDone}`;
}
function resetTimer() {
  clearInterval(ticking); ticking = null; onBreak = false;
  secondsLeft = focusMin * 60; $('#timerStart').textContent = 'Start'; drawTimer();
}
$('#timerPresets').addEventListener('click', e => {
  const btn = e.target.closest('[data-preset]');
  if (!btn) return;
  $$('#timerPresets .tab').forEach(t => t.classList.toggle('is-active', t === btn));
  [, focusMin, breakMin] = PRESETS[btn.dataset.preset];
  resetTimer();
});
$('#timerStart').onclick = () => {
  if (ticking) { clearInterval(ticking); ticking = null; $('#timerStart').textContent = 'Resume'; return; }
  $('#timerStart').textContent = 'Pause';
  ticking = setInterval(() => {
    secondsLeft--;
    if (secondsLeft < 0) {
      if (!onBreak) blocksDone++;
      onBreak = !onBreak;
      secondsLeft = (onBreak ? (blocksDone % 4 === 0 ? breakMin * 3 : breakMin) : focusMin) * 60;
    }
    drawTimer();
  }, 1000);
};
$('#timerReset').onclick = resetTimer;
resetTimer();

/* ---------------- auth UI ---------------- */
let authMode = 'signin';
const authError = msg => {
  const el = $('#authError');
  el.textContent = msg; el.hidden = !msg;
};
function setAuthMode(mode) {
  authMode = mode;
  $$('#authTabs .tab').forEach(t => t.classList.toggle('is-active', t.dataset.auth === mode));
  $('#authSubmit').textContent = mode === 'signin' ? 'Sign in' : 'Create account';
  $('#authPass').setAttribute('autocomplete', mode === 'signin' ? 'current-password' : 'new-password');
  $('#authHint').textContent = mode === 'signin'
    ? 'Profiles live in this browser only.'
    : 'At least 6 characters. Not a password you use elsewhere.';
  authError('');
}
/* Entering the view always starts clean: a stale sign-up tab would otherwise turn
   a returning user's sign-in attempt into a "that username is taken" error. */
function resetAuthView() {
  $('#authForm').reset();
  setAuthMode(Object.keys(users()).length ? 'signin' : 'signup');
}
$('#authTabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-auth]');
  if (btn) setAuthMode(btn.dataset.auth);
});

$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#authUser').value.trim();
  const pass = $('#authPass').value;
  authError('');
  if (name.length < 2) return authError('Pick a username of at least 2 characters.');
  if (pass.length < 6) return authError('Passwords must be at least 6 characters.');

  const all = users();
  const btn = $('#authSubmit');
  btn.disabled = true; btn.textContent = 'Working…';
  try {
    if (authMode === 'signup') {
      if (all[name]) { authError('That username is taken on this browser.'); return; }
      const salt = randomSalt();
      all[name] = { salt, hash: await hashPassword(pass, salt), created: Date.now(), subjects: [], year: null };
      saveUsers(all);
      signIn(name);
      navigate('setup');
    } else {
      const rec = all[name];
      if (!rec) { authError('No profile with that username in this browser.'); return; }
      const hash = await hashPassword(pass, rec.salt);
      if (hash !== rec.hash) { authError('Wrong password.'); return; }
      signIn(name);
      navigate(rec.year && rec.subjects && rec.subjects.length ? 'app' : 'setup');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
  }
});

/* Choosing "no account" is itself a decision: record it, or the dashboard's
   first-visit check would bounce straight back to this screen. */
$('#guestBtn').onclick = () => {
  signOut(false);
  saveProfile({ ack: true });
  navigate('app');
};

function signIn(name) {
  currentUser = name;
  try { localStorage.setItem(sessionKey, name); } catch (e) {}
  loadProgress();
  $('#authForm').reset();
  refreshStats();
}
function signOut(go = true) {
  currentUser = null;
  try { localStorage.removeItem(sessionKey); } catch (e) {}
  loadProgress();
  refreshStats();
  if (go) navigate('home');
}

function renderAccountButton() {
  const btn = $('#accountBtn');
  const cta = $('#navCta');
  if (currentUser) {
    btn.hidden = false;
    btn.textContent = currentUser;
    btn.onclick = () => navigate('settings');
    cta.textContent = 'My revision';
  } else {
    btn.hidden = false;
    btn.textContent = 'Sign in';
    btn.onclick = () => navigate('auth');
    cta.textContent = 'Open the app';
  }
}

/* ---------------- onboarding ---------------- */
let setupStep = 1, draft = { year: null, subjects: [] };

function renderYearChoices(mount, selected, onPick) {
  mount.innerHTML = YEARS.map(y => `
    <button class="choice${selected === y.id ? ' is-picked' : ''}" data-year="${esc(y.id)}">
      <b>${esc(y.n)}</b><span>${esc(y.note)}</span>
    </button>`).join('');
  $$('[data-year]', mount).forEach(b => b.onclick = () => { onPick(b.dataset.year); });
}
function renderSubjectChoices(mount, picked, onToggle) {
  mount.innerHTML = S.map(s => `
    <button class="choice choice--subject${picked.includes(s.id) ? ' is-picked' : ''}" data-pick="${esc(s.id)}" style="--subject:${esc(s.c)}">
      <span class="subject__mark">${esc(s.m)}</span>
      <b>${esc(s.n)}</b>
      <span>${subjectCards(s).length} cards</span>
    </button>`).join('');
  $$('[data-pick]', mount).forEach(b => b.onclick = () => onToggle(b.dataset.pick));
}

function paintSetup() {
  $('#setupStepLabel').textContent = `Step ${setupStep} of 2`;
  $('#setupYear').hidden = setupStep !== 1;
  $('#setupSubjects').hidden = setupStep !== 2;
  $('#setupBack').hidden = setupStep === 1;
  $('#setupTitle').textContent = setupStep === 1 ? 'What year are you in?' : 'Which subjects do you take?';
  $('#setupBlurb').textContent = setupStep === 1
    ? 'This sets how your countdown and daily targets work. You can change it later.'
    : 'Your dashboard, mixed review and daily due count will use just these. You can change them any time.';
  $('#setupNext').textContent = setupStep === 1 ? 'Continue' : 'Finish setup';
  if (setupStep === 1) {
    renderYearChoices($('#yearGrid'), draft.year, id => { draft.year = id; paintSetup(); });
  } else {
    renderSubjectChoices($('#subjectPicker'), draft.subjects, id => {
      draft.subjects = draft.subjects.includes(id) ? draft.subjects.filter(x => x !== id) : draft.subjects.concat(id);
      paintSetup();
    });
    $('#pickedCount').textContent = draft.subjects.length;
  }
}
$('#setupNext').onclick = () => {
  if (setupStep === 1) {
    if (!draft.year) return alert('Pick a year group to continue.');
    setupStep = 2; paintSetup(); window.scrollTo(0, 0); return;
  }
  if (!draft.subjects.length) return alert('Pick at least one subject.');
  saveProfile({ year: draft.year, subjects: draft.subjects });
  refreshStats();
  navigate('app');
};
$('#setupBack').onclick = () => { setupStep = 1; paintSetup(); };
$('#pickCore').onclick = () => { draft.subjects = S.filter(s => s.core).map(s => s.id); paintSetup(); };
$('#pickNone').onclick = () => { draft.subjects = []; paintSetup(); };

/* ---------------- settings ---------------- */
function paintSettings() {
  const p = profile();
  $('#settingsName').textContent = currentUser ? currentUser : 'Guest profile';
  renderYearChoices($('#settingsYear'), p.year, id => { saveProfile({ year: id }); paintSettings(); });
  const picked = p.subjects || [];
  renderSubjectChoices($('#settingsSubjects'), picked, id => {
    const next = picked.includes(id) ? picked.filter(x => x !== id) : picked.concat(id);
    saveProfile({ subjects: next });
    paintSettings(); refreshStats();
  });
  $('#settingsCount').textContent = picked.length;
  $('#settingsSignOut').hidden = !currentUser;
}
$('#settingsReset').onclick = () => {
  if (!confirm('Reset every box, streak, quiz score and blurt for this profile? This cannot be undone.')) return;
  P = { c: {}, days: [], quiz: {} };
  save(); refreshStats(); heroDeck.load();
  alert('Progress reset.');
};
$('#settingsSignOut').onclick = () => signOut();

/* ---------------- routing ---------------- */
const VIEWS = ['home', 'app', 'auth', 'setup', 'settings', 'mixed', 'methods', 'timer', 'subject'];
function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + name));
  $$('.nav__link').forEach(l => {
    const match = l.dataset.route === name || (name === 'subject' && l.dataset.route === 'app');
    l.setAttribute('aria-current', match ? 'page' : 'false');
  });
  armReveals();
}

function navigate(route) {
  if (route.startsWith('subject:')) { showView('subject'); openSubject(route.slice(8)); }
  else if (route === 'mixed') { showView('mixed'); mixDeck.load(); }
  else if (route === 'auth') { resetAuthView(); showView('auth'); }
  else if (route === 'setup') { setupStep = 1; draft = { year: profile().year || null, subjects: (profile().subjects || []).slice() }; paintSetup(); showView('setup'); }
  else if (route === 'settings') { paintSettings(); showView('settings'); }
  else if (route === 'app') {
    // first visit with no profile at all → offer accounts before the dashboard
    if (!currentUser && !readJSON('rni-guest-profile', null) && Object.keys(users()).length === 0 && !readJSON('rni', null)) {
      resetAuthView(); showView('auth'); route = 'auth';
    } else showView('app');
  }
  else if (VIEWS.includes(route)) showView(route);
  else { showView('home'); route = 'home'; }
  if (location.hash.slice(1) !== route) history.pushState(null, '', '#' + route);
  window.scrollTo(0, 0);
}

document.addEventListener('click', e => {
  const route = e.target.closest('[data-route]');
  const subject = e.target.closest('[data-subject]');
  const tryIt = e.target.closest('[data-try]');
  if (route) navigate(route.dataset.route);
  else if (subject) navigate('subject:' + subject.dataset.subject);
  else if (tryIt) {
    const target = tryIt.dataset.try;
    if (target === 'mixed') navigate('mixed');
    else {
      const first = (mySubjects()[0] || S[0]).id;
      navigate('subject:' + first);
      openSubject(first, target === 'cards' ? 'cards' : target === 'blurt' ? 'blurt' : 'topics');
    }
  }
});
window.addEventListener('popstate', () => navigate(location.hash.slice(1) || 'home'));

/* ---------------- reveals + nav ---------------- */
let observer = null;
function armReveals() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const items = $$('.view.is-active .reveal');
  if (reduce) { items.forEach(el => el.classList.add('is-in')); return; }
  if (!observer) {
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('is-in'); observer.unobserve(entry.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  }
  items.forEach(el => { if (!el.classList.contains('is-in')) observer.observe(el); });
}
const nav = $('#nav');
addEventListener('scroll', () => { nav.dataset.stuck = window.scrollY > 8; }, { passive: true });

/* ---------------- boot ---------------- */
try {
  const saved = localStorage.getItem(sessionKey);
  if (saved && users()[saved]) currentUser = saved;
} catch (e) {}
loadProgress();
refreshStats();
heroDeck.load();
navigate(location.hash.slice(1) || 'home');
})();
