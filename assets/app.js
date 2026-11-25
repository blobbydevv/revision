/* Revise NI — app logic
   Depends on assets/data.js (S = subjects, M = methods). */
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

/* ---------------- storage ---------------- */
const KEY = 'rni';
let P = {};
try { P = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { P = {}; }
P.c = P.c || {};          // card state: { box, due }
P.days = P.days || [];    // days studied, for the streak
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} };

const DAY = 864e5;
const today = () => Math.floor(Date.now() / DAY);
const INTERVALS = [0, 1, 2, 4, 8, 16];   // days, indexed by box

const ALL = [];
S.forEach(s => s.cards.forEach((c, i) => ALL.push({ k: s.id + ':' + i, s, q: c[0], a: c[1] })));

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
  if (!seen.has(t)) t--;              // today not studied yet: don't break yesterday's streak
  while (seen.has(t)) { n++; t--; }
  return n;
}

/* ---------------- theme ---------------- */
const themeToggle = $('#themeToggle');
const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
const syncThemeIcons = () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : prefersDark();
  $('.icon-btn__sun').style.display = dark ? 'none' : 'block';
  $('.icon-btn__moon').style.display = dark ? 'block' : 'none';
};
themeToggle.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : prefersDark();
  const next = dark ? 'light' : 'dark';
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
          <p class="flashcard__prompt">Nothing due here right now. Come back tomorrow, or run through the whole deck again for extra practice.</p>
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
          <span class="flashcard__subject"><i class="flashcard__dot"></i>${esc(current.s.n)}</span>
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
    if (score === 1) queue.splice(Math.min(3, queue.length), 0, current);  // see it again this session
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

  return {
    load() { queue = shuffle(getQueue(false)); render(); },
    flip, doRate,
    left: () => queue.length
  };
}

const heroDeck = Deck($('#heroCard'), $('#heroRate'), all => {
  const due = ALL.filter(isDue);
  return all || !due.length ? ALL.slice() : due;
});
const mixDeck = Deck($('#mixCard'), $('#mixRate'), all => (all ? ALL.slice() : ALL.filter(isDue)), {
  onDraw: left => { $('#mixLeft').textContent = left + ' card' + (left === 1 ? '' : 's') + ' left in this session'; },
  onEmpty: () => { $('#mixLeft').textContent = ''; }
});
let subjectDeck = null, activeSubject = null;

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

/* ---------------- stats + subject grid ---------------- */
function refreshStats() {
  const due = ALL.filter(isDue).length;
  const mastered = ALL.filter(c => state(c.k).b >= 5).length;
  const str = streak();

  const set = (sel, val) => { const el = $(sel); if (el) el.textContent = val; };
  set('#statSubjects', S.length);
  set('#statCards', ALL.length);
  set('#statDue', due);
  set('#statStreak', str);
  set('#appDue', due);
  set('#appMastered', mastered);
  set('#appStreak', str);
  set('#heroCount', S.length + ' subjects · ' + ALL.length + ' cards');

  const exam = P.exam || '2027-05-10';
  $('#examDate').value = exam;
  const days = Math.ceil((new Date(exam) - Date.now()) / DAY);
  set('#appDays', days > 0 ? days : '0');

  const hour = new Date().getHours();
  $('#greeting').textContent =
    (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening') +
    (due ? ` — ${due} card${due === 1 ? '' : 's'} due` : ' — nothing due, nice work');

  renderSubjectGrid();
}

$('#examDate').addEventListener('change', e => { P.exam = e.target.value; save(); refreshStats(); });

$('#resetProgress').addEventListener('click', () => {
  if (!confirm('Reset every box, streak and blurt saved in this browser? This cannot be undone.')) return;
  P = { c: {}, days: [] };
  save();
  refreshStats();
  heroDeck.load();
});

function renderSubjectGrid() {
  const grid = $('#subjectGrid');
  if (!grid) return;
  grid.innerHTML = S.map(s => {
    const known = s.cards.filter((c, i) => state(s.id + ':' + i).b >= 3).length;
    const due = s.cards.filter((c, i) => state(s.id + ':' + i).d <= today()).length;
    return `
      <button class="subject" data-subject="${s.id}" style="--subject:${esc(s.c)}">
        <span class="subject__mark">${esc(s.m)}</span>
        <span class="subject__name">${esc(s.n)}</span>
        <span class="subject__meta">${s.cards.length} cards · ${due} due · ${s.topics.length} topics</span>
        <span class="subject__bar"><i style="width:${Math.round(known / s.cards.length * 100)}%"></i></span>
      </button>`;
  }).join('');
}

$('#subjectChips').innerHTML = S.map(s => `<span>${esc(s.n)}</span>`).join('');

/* ---------------- search ---------------- */
$('#searchInput').addEventListener('input', e => {
  const term = e.target.value.trim().toLowerCase();
  const results = $('#searchResults');
  $$('.subject').forEach(btn => {
    const s = S.find(x => x.id === btn.dataset.subject);
    btn.style.display = !term || s.n.toLowerCase().includes(term) ? '' : 'none';
  });
  if (term.length < 3) { results.style.display = 'none'; return; }
  const hits = ALL.filter(c => (c.q + ' ' + c.a).toLowerCase().includes(term)).slice(0, 12);
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

/* ---------------- subject view ---------------- */
const TABS = [['cards', 'Flashcards'], ['quiz', 'Quiz'], ['blurt', 'Blurt'], ['topics', 'Topics & all cards']];
const subjectCards = () => ALL.filter(c => c.s === activeSubject);

function openSubject(id, tab = 'cards') {
  activeSubject = S.find(s => s.id === id);
  if (!activeSubject) { navigate('app'); return; }
  const head = $('#subjectHead');
  head.style.setProperty('--subject', activeSubject.c);
  head.innerHTML = `
    <div class="u-shell subject-head__inner">
      <button class="backlink" data-route="app">← All subjects</button>
      <div>
        <h1>${esc(activeSubject.n)}</h1>
        <p>CCEA GCSE · ${activeSubject.cards.length} cards · ${activeSubject.topics.length} topic areas</p>
      </div>
    </div>`;
  $('#subjectTabs').innerHTML = TABS.map(([k, label]) =>
    `<button class="tab${k === tab ? ' is-active' : ''}" data-tab="${k}">${label}</button>`).join('');
  PANELS[tab]();
}

const PANELS = {
  cards() {
    $('#subjectBody').innerHTML = `
      <div class="split">
        <div>
          <div class="deck"><div class="flashcard" id="subjectCard"></div></div>
          <div class="deck-rate" id="subjectRate"></div>
        </div>
        <div class="card card--pad">
          <h3>Why flashcards first?</h3>
          <p class="u-muted" style="margin-top:.6rem;font-size:.93rem">Retrieving an answer from memory strengthens it far more than reading it again. Cards you forget come back sooner; cards you know get pushed further away.</p>
          <p class="u-muted" style="margin-top:.75rem;font-size:.93rem">Keys: <b>Space</b> flip · <b>1</b> forgot · <b>2</b> shaky · <b>3</b> got it</p>
        </div>
      </div>`;
    subjectDeck = Deck($('#subjectCard'), $('#subjectRate'), all => {
      const cards = subjectCards(), due = cards.filter(isDue);
      return all || !due.length ? cards : due;
    });
    subjectDeck.load();
  },

  quiz() {
    subjectDeck = null;
    const questions = shuffle(subjectCards()).slice(0, 8);
    let i = 0, score = 0;

    const show = () => {
      if (i >= questions.length) {
        $('#subjectBody').innerHTML = `
          <div class="card card--pad" style="max-width:640px">
            <span class="eyebrow">Round complete</span>
            <h2 style="margin-top:1rem">${score} / ${questions.length}</h2>
            <p class="u-muted" style="margin-top:.75rem">${score === questions.length
              ? 'Perfect round. Push those cards further out with a flashcard session.'
              : 'Anything you got wrong has been sent back to box 1, so it will come up again soon.'}</p>
            <button class="btn btn--primary" style="margin-top:1.25rem" data-tab="quiz">Another round</button>
          </div>`;
        return;
      }
      const card = questions[i];
      const options = shuffle([card, ...shuffle(subjectCards().filter(x => x !== card)).slice(0, 3)]);
      $('#subjectBody').innerHTML = `
        <div class="card card--pad" style="max-width:780px">
          <p class="u-muted" style="font-size:.85rem">Question ${i + 1} of ${questions.length} · Score ${score}</p>
          <div class="progress"><i style="width:${i / questions.length * 100}%"></i></div>
          <h3 style="font-size:1.25rem;line-height:1.35">${esc(card.q)}</h3>
          <div style="margin-top:.5rem">${options.map((o, j) => `<button class="option" data-option="${j}">${esc(o.a)}</button>`).join('')}</div>
        </div>`;
      $$('.option').forEach((btn, j) => {
        btn.onclick = () => {
          if ($('.option.is-correct')) return;             // already answered
          const correct = options[j] === card;
          if (correct) score++;
          else { P.c[card.k] = { b: 1, d: today() }; save(); }
          $$('.option').forEach((el, k) => {
            if (options[k] === card) el.classList.add('is-correct');
            else if (k === j) el.classList.add('is-wrong');
          });
          setTimeout(() => { i++; show(); }, correct ? 700 : 1700);
        };
      });
    };
    show();
  },

  blurt() {
    subjectDeck = null;
    $('#subjectBody').innerHTML = `
      <div class="split">
        <div class="card card--pad">
          <label for="blurtTopic" style="font-weight:600;font-size:.92rem">Topic</label>
          <select id="blurtTopic" class="field" style="margin:.5rem 0 1rem">${activeSubject.topics.map(t => `<option>${esc(t)}</option>`).join('')}</select>
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
            <li>Check against the key points and tick what you got.</li>
            <li>Send the gaps to your flashcards and blurt again in a few days.</li>
          </ol>
        </div>
      </div>`;
    try { $('#blurtText').value = localStorage.getItem('rni-blurt-' + activeSubject.id) || ''; } catch (e) {}
    $('#blurtText').oninput = e => {
      try { localStorage.setItem('rni-blurt-' + activeSubject.id, e.target.value); } catch (x) {}
    };

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
      tick();
      ticker = setInterval(tick, 1000);
    };

    $('#blurtCheck').onclick = () => {
      const text = $('#blurtText').value.toLowerCase();
      $('#blurtResult').innerHTML = `<h3>Key points — tick what you included</h3>` +
        subjectCards().map(c => {
          const words = c.a.toLowerCase().match(/[a-z]{5,}/g) || [];
          const hit = words.length && words.filter(w => text.includes(w)).length / words.length > 0.3;
          return `<label class="check"><input type="checkbox" ${hit ? 'checked' : ''} data-card="${esc(c.k)}">
            <span><b>${esc(c.q)}</b><br><span class="u-muted">${esc(c.a)}</span></span></label>`;
        }).join('') +
        `<button class="btn btn--primary" id="blurtSave" style="margin-top:1rem">Send unticked to flashcards</button>`;
      $('#blurtSave').onclick = () => {
        $$('#blurtResult input').forEach(input => {
          if (!input.checked) P.c[input.dataset.card] = { b: 1, d: today() };
        });
        save(); refreshStats();
        $('#blurtSave').textContent = 'Done — gaps queued for today';
        $('#blurtSave').disabled = true;
      };
    };
  },

  topics() {
    subjectDeck = null;
    $('#subjectBody').innerHTML = `
      <div class="card card--pad" style="margin-bottom:1.25rem">
        <h3>Topic areas</h3>
        <div class="chipline" style="margin-top:.9rem">${activeSubject.topics.map(t => `<span>${esc(t)}</span>`).join('')}</div>
        <p class="u-muted" style="margin-top:1rem;font-size:.85rem">Check the current CCEA specification for your tier and options.</p>
      </div>
      <div class="card card--pad">
        <h3 style="margin-bottom:.5rem">All ${subjectCards().length} cards</h3>
        <div class="cardlist">${subjectCards().map(c => {
          const b = state(c.k).b;
          return `<div class="cardlist__row"><b>${esc(c.q)}</b><span>${esc(c.a)}</span><span class="cardlist__box">${b ? 'Box ' + b : 'New'}</span></div>`;
        }).join('')}</div>
      </div>`;
  }
};

$('#subjectTabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  $$('.tab', $('#subjectTabs')).forEach(t => t.classList.toggle('is-active', t === btn));
  PANELS[btn.dataset.tab]();
});
$('#subjectBody').addEventListener('click', e => {
  const btn = e.target.closest('[data-tab]');
  if (btn) PANELS[btn.dataset.tab]();
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
  secondsLeft = focusMin * 60;
  $('#timerStart').textContent = 'Start';
  drawTimer();
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

/* ---------------- routing ---------------- */
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
  else if (['home', 'app', 'methods', 'timer'].includes(route)) showView(route);
  else { showView('home'); route = 'home'; }
  if (location.hash.slice(1) !== route) history.pushState(null, '', '#' + route);
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
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
    else { navigate('subject:' + S[0].id); openSubject(S[0].id, target); }
  }
});
window.addEventListener('popstate', () => navigate(location.hash.slice(1) || 'home'));

/* ---------------- scroll reveal + nav shadow ---------------- */
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
refreshStats();
heroDeck.load();
navigate(location.hash.slice(1) || 'home');
})();
