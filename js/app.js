// ============================================================================
// Основная логика сайта: состояние, тесты, рендер экранов.
// Данные (вопросы, правители и т.д.) — в data.js. Firebase — в firebase.js.
// ============================================================================
import {
  IMG, RULERS, PERIODS, LEVELS, LEVEL_DESC, QUESTIONS,
  PERSONS, PERSON_CATEGORIES, DATES_KB, CATS, CAT_LABEL
} from './data.js';
import {
  auth, db,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updateProfile, deleteUser, doc, getDoc, setDoc, deleteDoc,
  translateAuthError
} from './firebase.js';

const state = {
  screen:'home', ctx:null, test:null, stats:{}, catStats:{},
  user:null,                 // {uid, name, email} — реальный пользователь Firebase, либо null (гость)
  completedTests:[],         // история пройденных тестов для достижений
  authMode:'login',          // 'login' | 'register'
  kbQuery:'', kbCategory:'Все',
  dateIdx: 0,                // текущая позиция в DATES_KB
  mistakes: new Set(),       // id вопросов, отвеченных сейчас неверно
  premiumInterest: false, premiumEmail:'',
  builder: { count:15, levels: new Set(LEVELS), cats: new Set(CATS), type:'any' }
};
LEVELS.forEach(l => state.stats[l] = {answered:0, correct:0});
CATS.forEach(c => state.catStats[c] = {answered:0, correct:0});

function normalize(s){
  return (s||'').toString().toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]/gi,'');
}
function checkAnswer(q, userValue){
  if(q.ty === 'm') return userValue === q.a;
  const accepted = [q.a, ...(q.alt||[])].map(normalize);
  return accepted.includes(normalize(userValue));
}
function recordAnswer(q, correct){
  const s = state.stats[q.lvl];
  s.answered++;
  if(correct) s.correct++;
  const cs = state.catStats[q.cat];
  if(cs){ cs.answered++; if(correct) cs.correct++; }
  if(correct) state.mistakes.delete(q.id); else state.mistakes.add(q.id);
  if(state.test){ state.test.results = state.test.results || []; state.test.results.push({cat:q.cat, correct}); }
}
function computeLevelInfo(){
  let total = 0;
  LEVELS.forEach(l => total += state.stats[l].answered);
  if(total < 5) return {level:null, progress:0, nextLevel:LEVELS[0], nextAcc:null};
  let achievedIdx = -1;
  LEVELS.forEach((l,i)=>{
    const s = state.stats[l];
    if(s.answered >= 2 && (s.correct/s.answered) >= 0.5) achievedIdx = i;
  });
  const level = achievedIdx >= 0 ? LEVELS[achievedIdx] : 'A1';
  const nextLevel = achievedIdx < LEVELS.length - 1 ? LEVELS[achievedIdx+1] : null;
  let progress = 100, nextAcc = null;
  if(nextLevel){
    const ns = state.stats[nextLevel];
    if(ns.answered > 0){ nextAcc = ns.correct/ns.answered; progress = Math.round(Math.min(nextAcc/0.5, 1)*100); }
    else { progress = 0; }
  }
  return {level, progress, nextLevel, nextAcc};
}
function estimateLevel(){ return computeLevelInfo().level; }
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; }
  return a;
}

/* ========================================================================
   TEST BUILDERS
   ======================================================================== */
function startLevelTest(level){ beginTest(shuffle(QUESTIONS.filter(q => q.lvl === level)).slice(0,10), 'level', level); }
function startRulerTest(rulerId){ beginTest(shuffle(QUESTIONS.filter(q => q.cat==='ruler' && q.ref===rulerId)), 'ruler', rulerId); }
function startPeriodTest(periodId){ beginTest(shuffle(QUESTIONS.filter(q => q.cat==='period' && q.ref===periodId)), 'period', periodId); }
function startCultureTest(){ beginTest(shuffle(QUESTIONS.filter(q => q.cat==='culture')), 'culture', null); }
function startDatesTest(){ beginTest(shuffle(QUESTIONS.filter(q => q.cat==='date')), 'dates', null); }
function startRandomTest(){ beginTest(shuffle(QUESTIONS).slice(0,15), 'random', null); }
function startMistakesTest(){
  const pool = QUESTIONS.filter(q => state.mistakes.has(q.id));
  if(pool.length === 0) return;
  beginTest(shuffle(pool), 'mistakes', null);
}
function startMockExam(){
  const byCat = {ruler:[], period:[], culture:[], date:[]};
  QUESTIONS.forEach(q => { if(byCat[q.cat]) byCat[q.cat].push(q); });
  const pick = (arr,n) => shuffle(arr).slice(0,n);
  const set = [...pick(byCat.ruler,9), ...pick(byCat.period,6), ...pick(byCat.culture,2), ...pick(byCat.date,2)];
  beginTest(shuffle(set), 'mock', null, {timed:true, seconds:2100});
}
function startCustomTest(){
  const b = state.builder;
  const pool = QUESTIONS.filter(q => b.levels.has(q.lvl) && b.cats.has(q.cat) && (b.type==='any' || q.ty===b.type));
  if(pool.length === 0) return;
  const n = Math.min(Math.max(1, b.count || 10), pool.length);
  beginTest(shuffle(pool).slice(0,n), 'custom', null);
}
function clearTestTimer(){
  if(state.test && state.test.timerId){ clearInterval(state.test.timerId); state.test.timerId = null; }
}
function startExamTimer(){
  const t = state.test;
  t.timerId = setInterval(() => {
    t.timeLeft--;
    const elm = document.getElementById('examTimer');
    if(elm){
      const left = Math.max(t.timeLeft,0);
      const m = Math.floor(left/60), s = left%60;
      elm.textContent = m + ':' + String(s).padStart(2,'0');
      elm.classList.toggle('low', t.timeLeft<=60);
    }
    if(t.timeLeft <= 0){
      clearInterval(t.timerId); t.timerId = null;
      t.idx = t.questions.length;
      render();
    }
  }, 1000);
}
function beginTest(questions, kind, ctx, opts){
  clearTestTimer();
  const timed = !!(opts && opts.timed);
  state.test = {questions, kind, ctx, idx:0, correctCount:0, answeredCurrent:false, recorded:false, results:[], timed, timeLeft:(opts && opts.seconds) || 0, timerId:null};
  state.screen = 'test';
  render();
  if(timed) startExamTimer();
}

/* ========================================================================
   RENDER
   ======================================================================== */
const TABS = [
  {id:'home', label:'Главная'},
  {id:'levels', label:'Уровни'},
  {id:'rulers', label:'Правители'},
  {id:'periods', label:'Периоды'},
  {id:'culture', label:'Культура'},
  {id:'general', label:'Общие тесты'},
  {id:'knowledge', label:'База знаний'},
  {id:'yearsdb', label:'Даты'},
  {id:'profile', label:'Профиль'},
];

function setScreen(id){ clearTestTimer(); state.screen = id; render(); window.scrollTo({top:0, behavior:'smooth'}); }

function renderTabs(){
  const nav = document.getElementById('tabs');
  nav.innerHTML = '';
  TABS.forEach(tab => {
    const btn = document.createElement('button');
    btn.textContent = tab.label;
    if(state.screen === tab.id) btn.classList.add('active');
    btn.onclick = () => setScreen(tab.id);
    nav.appendChild(btn);
  });
  const soon = document.createElement('button');
  soon.className = 'soon';
  soon.innerHTML = 'Конспекты <span class="badge-soon">скоро</span>';
  nav.appendChild(soon);
}
function renderHeaderLevel(){
  const lvl = estimateLevel();
  document.getElementById('headerLevel').innerHTML = 'Уровень: <b>' + (lvl || '—') + '</b>';
  const acc = document.getElementById('headerAccount');
  acc.textContent = state.user ? ('👤 ' + state.user.name) : 'Войти';
  acc.onclick = () => setScreen('profile');
}
function el(html){ const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

function render(){
  renderTabs();
  renderHeaderLevel();
  const app = document.getElementById('app');
  app.innerHTML = '';
  if(state.screen === 'test' && state.test){ app.appendChild(renderTestScreen()); return; }
  const map = {home:renderHome, levels:renderLevels, rulers:renderRulers, periods:renderPeriods, culture:renderCulture, general:renderGeneral, knowledge:renderKnowledge, person:renderPerson, yearsdb:renderDatesDB, profile:renderProfile, settings:renderSettings, premium:renderPremium};
  app.appendChild((map[state.screen] || renderHome)());
}

function renderHome(){
  const wrap = document.createElement('div');
  const lvl = computeLevelInfo();
  wrap.appendChild(el(`
    <div class="hero">
      <div>
        <h2>Проверь, насколько хорошо ты знаешь историю России</h2>
        <p>Тесты по правителям (от Ивана III до Путина), эпохам и культуре — с вариантами ответа и короткими письменными ответами,
        как в первой части ЕГЭ. Система незаметно следит за твоим уровнем подготовки, от A1 до C2.</p>
        <div class="actions">
          <button class="btn" onclick="startMockExam()">Пробник ЕГЭ · часть 1 (35 мин)</button>
          <button class="btn outline" onclick="setScreen('levels')">Начать с уровня</button>
        </div>
      </div>
      <div class="chronicle">
        <div class="caption">Твой примерный уровень</div>
        ${renderScaleHTML(lvl)}
        <div id="dateOfDay"></div>
      </div>
    </div>
  `));
  renderDateOfDay(wrap.querySelector('#dateOfDay'));

  const rulerCount = RULERS.length, periodCount = PERIODS.length, qCount = QUESTIONS.length;
  const statRow = el(`<div class="stat-row"></div>`);
  [[rulerCount,'правителей'], [periodCount,'периодов'], [qCount,'вопросов в базе'], [6,'уровней сложности']].forEach(([n,l])=>{
    statRow.appendChild(el(`<div class="stat-box"><div class="num">${n}</div><div class="lbl">${l}</div></div>`));
  });
  wrap.appendChild(statRow);

  const section = document.createElement('div');
  section.appendChild(el(`<div class="section-head"><h2>С чего начать</h2></div>`));
  const grid = el(`<div class="grid"></div>`);
  section.appendChild(grid);
  wrap.appendChild(section);

  const items = [
    {title:'Пробник ЕГЭ · часть 1', desc:'19 вопросов, 35 минут — по структуре и таймингу похоже на реальную часть 1 экзамена.', action:()=>startMockExam()},
    {title:'Тесты по уровню', desc:'От самых базовых вопросов (A1) до экспертных (C2).', action:()=>setScreen('levels')},
    {title:'Тесты по правителям', desc:'31 правитель — от Ивана III до Путина.', action:()=>setScreen('rulers')},
    {title:'Тесты по периодам', desc:'От племенных союзов до распада СССР.', action:()=>setScreen('periods')},
    {title:'Культура и памятники', desc:'Живопись, архитектура, литература с картинками.', action:()=>startCultureTest()},
    {title:'Полный рандом', desc:'15 случайных вопросов из всей базы.', action:()=>startRandomTest()},
  ];
  items.forEach(it=>{
    const card = el(`
      <div class="card">
        <div class="body">
          <h3>${it.title}</h3>
          <p class="desc">${it.desc}</p>
          <button class="cta">Перейти</button>
        </div>
      </div>
    `);
    card.querySelector('.cta').onclick = it.action;
    grid.appendChild(card);
  });

  const section2 = document.createElement('div');
  section2.style.marginTop = '38px';
  section2.appendChild(el(`<div class="section-head"><h2>Правители недели</h2><span class="count">случайная подборка</span></div>`));
  const grid2 = el(`<div class="grid"></div>`);
  section2.appendChild(grid2);
  wrap.appendChild(section2);
  shuffle(RULERS).slice(0,6).forEach(r=>{
    const imgHtml = r.img ? `<img class="img" src="${r.img}" alt="${r.name}" loading="lazy">` : `<div class="img placeholder">${r.name[0]}</div>`;
    const card = el(`
      <div class="card">
        ${imgHtml}
        <div class="body">
          <h3>${r.name}</h3>
          <div class="years">${r.years}</div>
          <button class="cta">Пройти тест</button>
        </div>
      </div>
    `);
    card.querySelector('.cta').onclick = () => startRulerTest(r.id);
    grid2.appendChild(card);
  });

  const promo = el(`
    <div class="premium-banner" style="margin-top:38px">
      <div>
        <div class="pb-tag">✨ Скоро</div>
        <h3 style="margin-top:6px">Летопись Premium</h3>
        <p>Полные пробники ЕГЭ, разбор персональных пробелов по темам и конспекты — в разработке.</p>
      </div>
      <button class="btn outline">Узнать первым</button>
    </div>
  `);
  promo.querySelector('.btn').onclick = () => setScreen('premium');
  wrap.appendChild(promo);

  return wrap;
}

function renderScaleHTML(info){
  const currentLevel = info.level;
  const idx = currentLevel ? LEVELS.indexOf(currentLevel) : -1;
  const pct = idx >= 0 ? (idx/(LEVELS.length-1))*100 : 0;
  let stops = '';
  LEVELS.forEach((l,i)=>{
    let cls = '';
    if(idx >= 0 && i < idx) cls = 'done';
    if(i === idx) cls = 'current';
    const left = (i/(LEVELS.length-1))*100;
    stops += `<div class="stop ${cls}" style="left:${left}%">${l}</div>`;
  });
  let statusLine;
  if(!currentLevel){
    statusLine = 'Пройди хотя бы 5 вопросов, чтобы увидеть оценку уровня.';
  } else if(!info.nextLevel){
    statusLine = 'Максимальный уровень достигнут: <b style="color:var(--accent)">C2</b>.';
  } else if(info.nextAcc === null){
    statusLine = 'Текущий уровень — <b style="color:var(--accent)">'+currentLevel+'</b>. Попробуй вопросы уровня <b>'+info.nextLevel+'</b>, чтобы продвинуться дальше.';
  } else {
    statusLine = 'Текущий уровень — <b style="color:var(--accent)">'+currentLevel+'</b>. До перехода на <b>'+info.nextLevel+'</b>: '+info.progress+'% (нужно закрепить точность ≥50% на его вопросах).';
  }
  const nextBar = (currentLevel && info.nextLevel) ? `
    <div style="margin-top:10px">
      <div style="display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:0.68rem;color:var(--text-faint);margin-bottom:4px">
        <span>Прогресс до ${info.nextLevel}</span><span>${info.progress}%</span>
      </div>
      <div class="test-progress-bar" style="margin-bottom:0"><div class="fill" style="width:${info.progress}%"></div></div>
    </div>` : '';
  return `<div class="scale"><div class="track"></div><div class="fill" style="width:${pct}%"></div>${stops}</div>
  ${nextBar}
  <div style="font-size:0.78rem;color:var(--text-dim);margin-top:10px">${statusLine}</div>`;
}

function renderLevels(){
  const wrap = el(`
    <div>
      <div class="section-head"><h2>Тесты по уровню подготовки</h2><span class="count">A1 → C2</span></div>
      <p class="lede">Как уровни владения языком: A1 — самые базовые вопросы, C2 — экспертные детали. Каждый тест собирает вопросы именно этого уровня сложности.</p>
      <div class="grid" id="levelGrid"></div>
    </div>
  `);
  const grid = wrap.querySelector('#levelGrid');
  LEVELS.forEach(l=>{
    const count = QUESTIONS.filter(q=>q.lvl===l).length;
    const card = el(`
      <div class="card level-card">
        <div class="body">
          <div class="letter">${l}</div>
          <p class="desc">${LEVEL_DESC[l]}</p>
          <div class="years">в базе: ${count} вопросов</div>
          <button class="cta">Пройти тест</button>
        </div>
      </div>
    `);
    card.querySelector('.cta').onclick = () => startLevelTest(l);
    grid.appendChild(card);
  });
  return wrap;
}

function renderRulers(){
  const wrap = el(`
    <div>
      <div class="section-head"><h2>Тесты по правителям</h2><span class="count">${RULERS.length} правителей</span></div>
      <p class="lede">От Ивана III до Владимира Путина. Каждый тест содержит вопросы разного уровня сложности.</p>
      <div class="grid" id="rulerGrid"></div>
    </div>
  `);
  const grid = wrap.querySelector('#rulerGrid');
  RULERS.forEach(r=>{
    const count = QUESTIONS.filter(q=>q.cat==='ruler' && q.ref===r.id).length;
    const imgHtml = r.img ? `<img class="img" src="${r.img}" alt="${r.name}" loading="lazy">` : `<div class="img placeholder">${r.name[0]}</div>`;
    const card = el(`
      <div class="card">
        ${imgHtml}
        <div class="body">
          <h3>${r.name}</h3>
          <div class="years">${r.years} · ${count} вопросов</div>
          <p class="desc">${r.desc}</p>
          <button class="cta">Пройти тест</button>
        </div>
      </div>
    `);
    card.querySelector('.cta').onclick = () => startRulerTest(r.id);
    grid.appendChild(card);
  });
  return wrap;
}

function renderPeriods(){
  const wrap = el(`
    <div>
      <div class="section-head"><h2>Тесты по периодам</h2><span class="count">${PERIODS.length} эпох</span></div>
      <p class="lede">От племенных союзов восточных славян до распада СССР — без пропусков по годам.</p>
      <div class="grid" id="periodGrid"></div>
    </div>
  `);
  const grid = wrap.querySelector('#periodGrid');
  PERIODS.forEach(p=>{
    const count = QUESTIONS.filter(q=>q.cat==='period' && q.ref===p.id).length;
    const imgHtml = p.img ? `<img class="img" src="${p.img}" alt="${p.name}" loading="lazy">` : `<div class="img placeholder">✦</div>`;
    const card = el(`
      <div class="card">
        ${imgHtml}
        <div class="body">
          <h3>${p.name}</h3>
          <div class="years">${p.years} · ${count} вопросов</div>
          <p class="desc">${p.desc}</p>
          <button class="cta">Пройти тест</button>
        </div>
      </div>
    `);
    card.querySelector('.cta').onclick = () => startPeriodTest(p.id);
    grid.appendChild(card);
  });
  return wrap;
}

function renderCulture(){
  const count = QUESTIONS.filter(q=>q.cat==='culture').length;
  const wrap = el(`
    <div>
      <div class="section-head"><h2>Культура и памятники</h2><span class="count">${count} вопросов</span></div>
      <p class="lede">Живопись, архитектура, литература и памятники — с изображениями там, где это уместно.</p>
      <div class="grid" id="cultureGrid"></div>
    </div>
  `);
  const grid = wrap.querySelector('#cultureGrid');
  [{img:IMG.basil, title:'Собор Василия Блаженного', sub:'архитектура'},
   {img:IMG.bronze, title:'Медный всадник', sub:'памятник и литература'},
   {img:IMG.millennium, title:'«Тысячелетие России»', sub:'памятник, Новгород'}].forEach(c=>{
    grid.appendChild(el(`<div class="card"><img class="img" src="${c.img}" alt="${c.title}" loading="lazy"><div class="body"><h3>${c.title}</h3><div class="years">${c.sub}</div></div></div>`));
  });
  const cta = el(`<div style="margin-top:22px"><button class="btn">Пройти тест по культуре</button></div>`);
  cta.querySelector('.btn').onclick = () => startCultureTest();
  wrap.appendChild(cta);
  return wrap;
}

function renderGeneral(){
  const wrap = el(`
    <div>
      <div class="section-head"><h2>Общие тесты</h2></div>
      <p class="lede">Проверь себя без привязки к конкретному правителю или эпохе.</p>
      <div class="grid" id="generalGrid"></div>
    </div>
  `);
  const grid = wrap.querySelector('#generalGrid');
  const dateCount = QUESTIONS.filter(q=>q.cat==='date').length;
  const c0 = el(`<div class="card"><div class="body"><h3>Пробник ЕГЭ · часть 1</h3><div class="years">19 вопросов · 35 минут · с таймером</div><p class="desc">Пропорции разделов и лимит времени приближены к реальной части 1 экзамена: правители, периоды, культура, даты.</p><button class="cta">Начать</button></div></div>`);
  c0.querySelector('.cta').onclick = () => startMockExam();
  grid.appendChild(c0);
  const c1 = el(`<div class="card"><div class="body"><h3>Тест на даты</h3><div class="years">${dateCount} вопросов · впиши год</div><p class="desc">Только ключевые даты российской истории — впиши год цифрами.</p><button class="cta">Начать</button></div></div>`);
  c1.querySelector('.cta').onclick = () => startDatesTest();
  grid.appendChild(c1);
  const c2 = el(`<div class="card"><div class="body"><h3>Полный рандом</h3><div class="years">15 вопросов из всей базы</div><p class="desc">Смесь правителей, эпох, культуры и дат любого уровня сложности.</p><button class="cta">Начать</button></div></div>`);
  c2.querySelector('.cta').onclick = () => startRandomTest();
  grid.appendChild(c2);
  const mistakeCount = state.mistakes.size;
  const c3 = el(`<div class="card"><div class="body"><h3>Работа над ошибками</h3><div class="years">${mistakeCount} вопрос${mistakeCount===1?'':(mistakeCount>=2&&mistakeCount<=4?'а':'ов')} в списке</div><p class="desc">Все вопросы, где ты пока ответил неверно, собраны в один тест.</p><button class="cta" ${mistakeCount===0?'disabled':''}>${mistakeCount===0?'Пока пусто':'Начать'}</button></div></div>`);
  if(mistakeCount>0) c3.querySelector('.cta').onclick = () => startMistakesTest();
  grid.appendChild(c3);

  wrap.appendChild(el(`<div class="section-head" style="margin-top:34px"><h2>Собрать свой тест</h2></div>`));
  wrap.appendChild(el(`<p class="lede">Выбери уровни сложности, разделы и сколько вопросов хочешь получить.</p>`));

  const b = state.builder;
  const box = el(`<div class="chronicle" style="max-width:640px"></div>`);

  box.appendChild(el(`<div class="caption">Уровни сложности</div>`));
  const lvlChips = el(`<div class="chips"></div>`);
  LEVELS.forEach(l=>{
    const chip = el(`<button class="chip ${b.levels.has(l)?'active':''}">${l}</button>`);
    chip.onclick = () => { if(b.levels.has(l)){ if(b.levels.size>1) b.levels.delete(l); } else b.levels.add(l); render(); };
    lvlChips.appendChild(chip);
  });
  box.appendChild(lvlChips);

  box.appendChild(el(`<div class="caption" style="margin-top:16px">Разделы</div>`));
  const catChips = el(`<div class="chips"></div>`);
  CATS.forEach(c=>{
    const chip = el(`<button class="chip ${b.cats.has(c)?'active':''}">${CAT_LABEL[c]}</button>`);
    chip.onclick = () => { if(b.cats.has(c)){ if(b.cats.size>1) b.cats.delete(c); } else b.cats.add(c); render(); };
    catChips.appendChild(chip);
  });
  box.appendChild(catChips);

  box.appendChild(el(`<div class="caption" style="margin-top:16px">Тип вопросов</div>`));
  const typeChips = el(`<div class="chips"></div>`);
  [['any','Любой'], ['m','С вариантами'], ['t','Письменный ответ']].forEach(([val,label])=>{
    const chip = el(`<button class="chip ${b.type===val?'active':''}">${label}</button>`);
    chip.onclick = () => { b.type = val; render(); };
    typeChips.appendChild(chip);
  });
  box.appendChild(typeChips);

  const pool = QUESTIONS.filter(q => b.levels.has(q.lvl) && b.cats.has(q.cat) && (b.type==='any' || q.ty===b.type));
  const safeCount = Math.min(b.count || 10, Math.max(pool.length,1));
  const countRow = el(`
    <div style="margin-top:18px;display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap">
      <div class="field" style="margin:0;max-width:150px">
        <label>Количество вопросов</label>
        <input type="number" id="builderCount" min="1" max="${Math.max(pool.length,1)}" value="${safeCount}">
      </div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:var(--text-faint);padding-bottom:11px">доступно вопросов: ${pool.length}</div>
    </div>
  `);
  const countInput = countRow.querySelector('#builderCount');
  countInput.oninput = () => {
    const v = parseInt(countInput.value, 10);
    b.count = isNaN(v) ? b.count : v;
  };
  box.appendChild(countRow);

  const startBtn = el(`<button class="btn" style="margin-top:16px" ${pool.length===0?'disabled':''}>${pool.length===0?'Нет подходящих вопросов':'Собрать тест'}</button>`);
  startBtn.onclick = () => startCustomTest();
  box.appendChild(startBtn);
  wrap.appendChild(box);

  return wrap;
}

function renderStatRowItem(label, answered, correct, opts){
  opts = opts || {};
  const pct = answered ? Math.round(100*correct/answered) : null;
  return el(`
    <div class="stat-row-item ${opts.wide?'wide-label':''}">
      <div class="srl-badge">${label}</div>
      <div>
        <div class="srl-bar-track"><div class="srl-bar-fill" style="width:${pct||0}%"></div></div>
        <div class="srl-meta">${answered ? correct+' из '+answered+' верно' : 'нет данных'}</div>
      </div>
      <div class="srl-pct ${pct===null?'empty':''}">${pct===null ? '—' : pct+'%'}</div>
    </div>
  `);
}

function renderProfile(){
  if(!state.user) return renderAuthForm();

  const wrap = document.createElement('div');
  wrap.appendChild(el(`<div class="section-head"><h2>Профиль</h2></div>`));

  wrap.appendChild(el(`
    <div class="profile-card">
      <div class="profile-avatar">${state.user.name[0].toUpperCase()}</div>
      <div style="flex:1">
        <h3>${state.user.name}</h3>
        <div class="years">${state.user.email || 'без почты'}</div>
      </div>
    </div>
  `));
  const settingsBtn = el(`<button class="btn outline" style="margin-top:14px">⚙ Настройки аккаунта</button>`);
  settingsBtn.onclick = () => setScreen('settings');
  wrap.appendChild(settingsBtn);

  const lvl = computeLevelInfo();
  wrap.appendChild(el(`
    <div class="chronicle" style="max-width:560px;margin-top:28px">
      <div class="caption">Текущая оценка</div>
      ${renderScaleHTML(lvl)}
    </div>
  `));

  wrap.appendChild(el(`<div class="section-head" style="margin-top:34px"><h2>Точность по уровням сложности</h2></div>`));
  const levelRows = el(`<div class="stat-rows"></div>`);
  LEVELS.forEach(l => levelRows.appendChild(renderStatRowItem(l, state.stats[l].answered, state.stats[l].correct)));
  wrap.appendChild(levelRows);

  wrap.appendChild(el(`<div class="section-head" style="margin-top:34px"><h2>Сильные и слабые разделы</h2></div>`));
  const catRows = el(`<div class="stat-rows"></div>`);
  CATS.forEach(c => catRows.appendChild(renderStatRowItem(CAT_LABEL[c], state.catStats[c].answered, state.catStats[c].correct, {wide:true})));
  wrap.appendChild(catRows);

  const mistakeCount = state.mistakes.size;
  wrap.appendChild(el(`<div class="section-head" style="margin-top:34px"><h2>Работа над ошибками</h2><span class="count">${mistakeCount} вопросов</span></div>`));
  const mistakeBox = el(`
    <div class="chronicle" style="max-width:520px">
      <p style="margin:0 0 14px;color:var(--text-dim);font-size:0.88rem">
        ${mistakeCount>0
          ? 'Здесь копятся все вопросы, на которые ты пока ответил неверно. Пройди их ещё раз — верный ответ уберёт вопрос из списка.'
          : 'Пока нет накопленных ошибок — они появятся здесь сразу, как только ты где-то ответишь неверно.'}
      </p>
      <button class="btn" ${mistakeCount===0?'disabled':''}>Пройти работу над ошибками</button>
    </div>
  `);
  if(mistakeCount>0) mistakeBox.querySelector('.btn').onclick = () => startMistakesTest();
  wrap.appendChild(mistakeBox);

  wrap.appendChild(el(`<div class="section-head" style="margin-top:34px"><h2>Достижения</h2><span class="count">${computeAchievements().filter(b=>b.earned).length} / ${computeAchievements().length}</span></div>`));
  const badges = el(`<div class="badges-grid"></div>`);
  computeAchievements().forEach(b=>{
    badges.appendChild(el(`
      <div class="badge ${b.earned?'earned':''}">
        <div class="bi">${b.icon}</div>
        <div class="bt">${b.title}</div>
        <div class="bd">${b.desc}</div>
      </div>
    `));
  });
  wrap.appendChild(badges);
  return wrap;
}

/* ========================================================================
   ДОСТИЖЕНИЯ
   ======================================================================== */
function computeAchievements(){
  const done = state.completedTests;
  const rulersTried = new Set(done.filter(t=>t.kind==='ruler').map(t=>t.ctx)).size;
  const perfectDates = done.some(t=>t.kind==='dates' && t.correct===t.total && t.total>0);
  const mockDone = done.some(t=>t.kind==='mock');
  const lvl = estimateLevel();
  return [
    {icon:'🏁', title:'Первые шаги', desc:'Пройди свой первый тест', earned: done.length>=1},
    {icon:'📜', title:'Знаток дат', desc:'Пройди тест на даты без единой ошибки', earned: perfectDates},
    {icon:'👑', title:'Знаток правителей', desc:'Пройди тесты по 5 разным правителям', earned: rulersTried>=5},
    {icon:'🗺️', title:'Собиратель земель', desc:'Пройди тесты по 15 разным правителям', earned: rulersTried>=15},
    {icon:'⏱️', title:'Экзаменатор', desc:'Пройди мини-пробник ЕГЭ целиком', earned: mockDone},
    {icon:'🔥', title:'Марафонец', desc:'Пройди 10 тестов', earned: done.length>=10},
    {icon:'🎓', title:'Эксперт', desc:'Достигни уровня C2', earned: lvl==='C2'},
  ];
}

/* ========================================================================
   PREMIUM (тизер — сбор интереса перед запуском платных функций)
   ======================================================================== */
function renderPremium(){
  const wrap = document.createElement('div');
  const back = el(`<a class="back-link" href="#">← Назад</a>`);
  back.onclick = (e)=>{ e.preventDefault(); setScreen('home'); };
  wrap.appendChild(back);
  wrap.appendChild(el(`<div class="section-head"><h2>Летопись Premium</h2><span class="count">в разработке</span></div>`));
  wrap.appendChild(el(`<p class="lede">Сайт бесплатный и таким и останется в основной части. Отдельно готовится платный набор функций для тех, кто занимается подготовкой к ЕГЭ/ОГЭ вплотную.</p>`));

  const features = [
    ['📚', 'Полные пробники ЕГЭ', 'Полноформатные варианты части 1 и части 2 с реальными лимитами времени.'],
    ['📊', 'Персональная аналитика пробелов', 'Не просто уровень A1–C2, а конкретный список тем и вопросов, которые стоит повторить.'],
    ['📝', 'Конспекты по темам', 'Короткие структурированные конспекты, привязанные к разделам тестов.'],
    ['👨‍🏫', 'Кабинет для репетиторов', 'Добавление учеников и просмотр их прогресса по темам в одном месте.'],
  ];
  const fgrid = el(`<div class="grid"></div>`);
  features.forEach(([icon,title,desc])=>{
    fgrid.appendChild(el(`
      <div class="card"><div class="body">
        <div style="font-size:1.4rem">${icon}</div>
        <h3>${title}</h3>
        <p class="desc">${desc}</p>
      </div></div>
    `));
  });
  wrap.appendChild(fgrid);

  const formHolder = document.createElement('div');
  formHolder.style.marginTop = '28px';
  wrap.appendChild(formHolder);

  const paintForm = () => {
    formHolder.innerHTML = '';
    if(state.premiumInterest){
      formHolder.appendChild(el(`
        <div class="auth-card">
          <h3 style="margin-bottom:6px">Готово 🎉</h3>
          <p class="lede" style="margin:0">Записал твой интерес. Как только появятся платные функции — дадим знать в первую очередь.</p>
        </div>
      `));
      return;
    }
    const card = el(`
      <div class="auth-card">
        <h3 style="margin-bottom:12px">Узнать первым о запуске</h3>
        <div class="field"><label>Почта</label><input type="text" id="premEmail" placeholder="you@example.com" value="${state.premiumEmail}"></div>
        <button class="btn" style="width:100%;margin-top:6px">Оставить заявку</button>
        <div class="auth-note">Демо-режим: заявка нигде не сохраняется — это способ проверить, интересна ли людям такая функция, до того как она будет готова.</div>
      </div>
    `);
    card.querySelector('.btn').onclick = () => {
      state.premiumEmail = card.querySelector('#premEmail').value.trim();
      state.premiumInterest = true;
      paintForm();
    };
    formHolder.appendChild(card);
  };
  paintForm();

  return wrap;
}

/* ========================================================================
   БАЗА ЗНАНИЙ (личности)
   ======================================================================== */
function renderKnowledge(){
  const wrap = el(`
    <div>
      <div class="section-head"><h2>База знаний</h2><span class="count">${PERSONS.length} личностей</span></div>
      <p class="lede">Исторические деятели России — правители, полководцы, деятели культуры и науки. Раздел будет пополняться.</p>
      <div class="search-row"><input type="text" id="kbSearch" placeholder="Найти по имени..." value="${state.kbQuery}"></div>
      <div class="chips" id="kbChips"></div>
      <div class="grid" id="kbGrid"></div>
    </div>
  `);
  const chips = wrap.querySelector('#kbChips');
  PERSON_CATEGORIES.forEach(cat=>{
    const chip = el(`<button class="chip ${state.kbCategory===cat?'active':''}">${cat}</button>`);
    chip.onclick = () => { state.kbCategory = cat; render(); };
    chips.appendChild(chip);
  });
  const grid = wrap.querySelector('#kbGrid');
  const q = normalize(state.kbQuery);
  const filtered = PERSONS.filter(p=>{
    const matchQ = !q || normalize(p.name).includes(q);
    const matchCat = state.kbCategory==='Все' || p.category===state.kbCategory;
    return matchQ && matchCat;
  });
  if(filtered.length===0){
    grid.appendChild(el(`<div class="empty-note">Никого не нашлось. Попробуй другой запрос или категорию.</div>`));
  }
  filtered.forEach(p=>{
    const imgHtml = p.img ? `<img class="img" src="${p.img}" alt="${p.name}" loading="lazy">` : `<div class="img placeholder">${p.name[0]}</div>`;
    const card = el(`
      <div class="card person-card">
        ${imgHtml}
        <div class="body">
          <h3>${p.name}</h3>
          <div class="years">${p.years} · ${p.category}</div>
          <p class="desc">${p.bio.slice(0,90)}${p.bio.length>90?'…':''}</p>
        </div>
      </div>
    `);
    card.onclick = () => { state.ctx = p.id; setScreen('person'); };
    grid.appendChild(card);
  });
  const input = wrap.querySelector('#kbSearch');
  input.addEventListener('input', (e)=>{ state.kbQuery = e.target.value; render(); document.getElementById('kbSearch').focus(); document.getElementById('kbSearch').selectionStart = document.getElementById('kbSearch').value.length; });
  return wrap;
}

function renderPerson(){
  const p = PERSONS.find(x=>x.id===state.ctx);
  if(!p) return renderKnowledge();
  const wrap = document.createElement('div');
  const back = el(`<a class="back-link" href="#">← Ко всей базе знаний</a>`);
  back.onclick = (e)=>{ e.preventDefault(); setScreen('knowledge'); };
  wrap.appendChild(back);
  const imgHtml = p.img ? `<img src="${p.img}" alt="${p.name}">` : `<div class="ph">${p.name[0]}</div>`;
  wrap.appendChild(el(`
    <div class="person-detail">
      ${imgHtml}
      <div>
        <div class="role">${p.category}</div>
        <h2>${p.name}</h2>
        <div class="years">${p.years}</div>
        <p>${p.bio}</p>
      </div>
    </div>
  `));
  return wrap;
}

/* ========================================================================
   БАЗА ЗНАНИЙ (даты) — навигатор по годам
   ======================================================================== */
function renderDatesDB(){
  const wrap = el(`
    <div>
      <div class="section-head"><h2>Даты</h2><span class="count">${DATES_KB.length} записей · 862 — 2020-е</span></div>
      <p class="lede">Введи год, чтобы узнать, что произошло в этом году, и листай вперёд-назад по ближайшим датам. Раздел будет пополняться.</p>
      <div class="search-row">
        <input type="number" id="yearSearch" placeholder="Например, 1812">
        <button class="btn" id="yearGoBtn">Найти</button>
      </div>
      <div id="yearNavHolder"></div>
      <div class="section-head" style="margin-top:34px"><h2>Все записи</h2></div>
      <div class="date-list" id="dateListHolder"></div>
    </div>
  `);
  const holder = wrap.querySelector('#yearNavHolder');
  renderYearNav(holder);

  const input = wrap.querySelector('#yearSearch');
  const go = () => {
    const y = parseInt(input.value, 10);
    if(isNaN(y)) return;
    let idx = DATES_KB.findIndex(d=>d.year===y);
    if(idx===-1){
      // ближайший год
      let best=0, bestDiff=Infinity;
      DATES_KB.forEach((d,i)=>{ const diff=Math.abs(d.year-y); if(diff<bestDiff){bestDiff=diff; best=i;} });
      idx = best;
    }
    state.dateIdx = idx;
    renderYearNav(holder);
  };
  wrap.querySelector('#yearGoBtn').onclick = go;
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') go(); });

  const list = wrap.querySelector('#dateListHolder');
  DATES_KB.forEach((d,i)=>{
    const row = el(`<div class="date-row"><div class="y">${d.year}</div><div class="t">${d.title}</div></div>`);
    row.onclick = () => { state.dateIdx = i; renderYearNav(holder); window.scrollTo({top:0, behavior:'smooth'}); };
    list.appendChild(row);
  });
  return wrap;
}

function renderYearNav(holder){
  holder.innerHTML = '';
  const i = state.dateIdx;
  const d = DATES_KB[i];
  const prevBtn = el(`<button class="arrow" ${i<=0?'disabled':''}>‹</button>`);
  const nextBtn = el(`<button class="arrow" ${i>=DATES_KB.length-1?'disabled':''}>›</button>`);
  prevBtn.onclick = () => { if(i>0){ state.dateIdx--; renderYearNav(holder); } };
  nextBtn.onclick = () => { if(i<DATES_KB.length-1){ state.dateIdx++; renderYearNav(holder); } };
  const body = el(`
    <div class="year-body">
      <div class="year-num">${d.year}</div>
      <div class="year-title">${d.title}</div>
      <div class="year-desc">${d.desc}</div>
      <div class="year-pos">запись ${i+1} из ${DATES_KB.length}</div>
    </div>
  `);
  const nav = el(`<div class="year-nav"></div>`);
  nav.appendChild(prevBtn); nav.appendChild(body); nav.appendChild(nextBtn);
  holder.appendChild(nav);
}

function renderDateOfDay(holder){
  if(!holder) return;
  let idx = Math.floor(Math.random()*DATES_KB.length);
  const paint = () => {
    const d = DATES_KB[idx];
    holder.innerHTML = '';
    holder.appendChild(el(`
      <div class="dateday">
        <div class="caption"><span>Дата дня</span><button class="reroll">другая →</button></div>
        <div class="year-num">${d.year}</div>
        <div class="year-title">${d.title}</div>
        <div class="year-desc">${d.desc}</div>
      </div>
    `));
    holder.querySelector('.reroll').onclick = () => { idx = Math.floor(Math.random()*DATES_KB.length); paint(); };
  };
  paint();
}

/* ========================================================================
   АККАУНТ (демо-режим, без бэкенда — данные живут только в этой сессии)
   ======================================================================== */
function renderAuthForm(){
  const wrap = el(`
    <div>
      <div class="section-head"><h2>Профиль</h2></div>
      <p class="lede">Зарегистрируйся, чтобы прогресс сохранялся навсегда и был доступен с любого устройства.</p>
      <div class="auth-card">
        <div class="auth-tabs">
          <button data-m="login" class="${state.authMode==='login'?'active':''}">Вход</button>
          <button data-m="register" class="${state.authMode==='register'?'active':''}">Регистрация</button>
        </div>
        <div id="authFields"></div>
        <div id="authError"></div>
        <button class="btn" id="authSubmit" style="width:100%;margin-top:6px">${state.authMode==='login'?'Войти':'Зарегистрироваться'}</button>
        <div class="auth-note">Пароль хранится и проверяется Firebase Authentication — сайт его не видит и не хранит сам.</div>
      </div>
    </div>
  `);
  wrap.querySelectorAll('.auth-tabs button').forEach(b=>{
    b.onclick = () => { state.authMode = b.dataset.m; render(); };
  });
  const fields = wrap.querySelector('#authFields');
  if(state.authMode==='register'){
    fields.appendChild(el(`<div class="field"><label>Имя</label><input type="text" id="fName" placeholder="Как к тебе обращаться"></div>`));
    fields.appendChild(el(`<div class="field"><label>Почта</label><input type="text" id="fEmail" placeholder="you@example.com"></div>`));
    fields.appendChild(el(`<div class="field"><label>Пароль</label><input type="password" id="fPass" placeholder="минимум 6 символов"></div>`));
  } else {
    fields.appendChild(el(`<div class="field"><label>Почта</label><input type="text" id="fEmail" placeholder="you@example.com"></div>`));
    fields.appendChild(el(`<div class="field"><label>Пароль</label><input type="password" id="fPass" placeholder="••••••••"></div>`));
  }
  const errBox = wrap.querySelector('#authError');
  const submitBtn = wrap.querySelector('#authSubmit');
  submitBtn.onclick = async () => {
    errBox.innerHTML = '';
    const emailField = wrap.querySelector('#fEmail');
    const passField = wrap.querySelector('#fPass');
    const nameField = wrap.querySelector('#fName');
    const email = (emailField ? emailField.value : '').trim();
    const pass = passField ? passField.value : '';
    if(!email || !pass){
      errBox.appendChild(el(`<div class="feedback bad" style="margin:10px 0">Заполни почту и пароль.</div>`));
      return;
    }
    submitBtn.disabled = true;
    try{
      if(state.authMode==='register'){
        const name = (nameField && nameField.value.trim()) || (email.split('@')[0] || 'Гость');
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(cred.user, {displayName: name});
        await setDoc(doc(db, 'users', cred.user.uid), {
          name, email,
          stats: state.stats, catStats: state.catStats,
          mistakes: [], completedTests: [],
          createdAt: Date.now()
        });
      } else {
        await signInWithEmailAndPassword(auth, email, pass);
      }
      // onAuthStateChanged сам подхватит пользователя и перерисует экран
      setScreen('profile');
    } catch(e){
      console.error('Ошибка авторизации Firebase:', e);
      errBox.appendChild(el(`<div class="feedback bad" style="margin:10px 0">${translateAuthError(e.code)}</div>`));
      submitBtn.disabled = false;
    }
  };
  return wrap;
}

function renderSettings(){
  if(!state.user) return renderAuthForm();

  const wrap = document.createElement('div');
  const back = el(`<a class="back-link" href="#">← Назад в профиль</a>`);
  back.onclick = (e) => { e.preventDefault(); setScreen('profile'); };
  wrap.appendChild(back);
  wrap.appendChild(el(`<div class="section-head"><h2>Настройки аккаунта</h2></div>`));

  // смена имени
  const nickCard = el(`
    <div class="auth-card">
      <h3 style="margin-bottom:12px">Имя в профиле</h3>
      <div class="field"><label>Имя</label><input type="text" id="stName" value="${state.user.name}"></div>
      <div id="nickMsg"></div>
      <button class="btn" id="nickSave" style="width:100%;margin-top:6px">Сохранить имя</button>
    </div>
  `);
  const nickMsg = nickCard.querySelector('#nickMsg');
  const nickBtn = nickCard.querySelector('#nickSave');
  nickBtn.onclick = async () => {
    nickMsg.innerHTML = '';
    const newName = nickCard.querySelector('#stName').value.trim();
    if(!newName){ nickMsg.appendChild(el(`<div class="feedback bad" style="margin:10px 0">Имя не может быть пустым.</div>`)); return; }
    nickBtn.disabled = true;
    try{
      await updateProfile(auth.currentUser, {displayName:newName});
      await setDoc(doc(db,'users',state.user.uid), {name:newName}, {merge:true});
      state.user.name = newName;
      nickMsg.appendChild(el(`<div class="feedback ok" style="margin:10px 0">Готово, имя обновлено.</div>`));
      renderHeaderLevel();
    } catch(e){
      console.error('Не удалось изменить имя:', e);
      nickMsg.appendChild(el(`<div class="feedback bad" style="margin:10px 0">Не получилось сохранить. Попробуй ещё раз.</div>`));
    }
    nickBtn.disabled = false;
  };
  wrap.appendChild(nickCard);

  // выход
  const logoutBtn = el(`<button class="btn outline" style="margin-top:24px">Выйти из аккаунта</button>`);
  logoutBtn.onclick = async () => { await signOut(auth); setScreen('home'); };
  wrap.appendChild(logoutBtn);

  // опасная зона: удаление аккаунта
  const dangerCard = el(`
    <div class="auth-card danger-card" style="margin-top:30px">
      <h3 style="margin-bottom:8px;color:#f5989d">Опасная зона</h3>
      <p class="lede" style="margin:0 0 14px">Удаление аккаунта необратимо: пропадут прогресс, достижения и вход по этой почте.</p>
      <button class="btn danger" id="delBtn">Удалить аккаунт</button>
      <div id="delMsg"></div>
    </div>
  `);
  let confirmStage = false;
  const delBtn = dangerCard.querySelector('#delBtn');
  const delMsg = dangerCard.querySelector('#delMsg');
  delBtn.onclick = async () => {
    if(!confirmStage){
      confirmStage = true;
      delBtn.textContent = 'Точно удалить? Нажми ещё раз';
      return;
    }
    delBtn.disabled = true;
    delMsg.innerHTML = '';
    try{
      const uid = state.user.uid;
      await deleteDoc(doc(db, 'users', uid));
      await deleteUser(auth.currentUser);
      // onAuthStateChanged сбросит state.user и перерисует экран сам
      setScreen('home');
    } catch(e){
      console.error('Не удалось удалить аккаунт:', e);
      const msg = e.code === 'auth/requires-recent-login'
        ? 'Для удаления нужно недавно входить в аккаунт — выйди и зайди снова, затем повтори.'
        : 'Не получилось удалить аккаунт. Попробуй ещё раз.';
      delMsg.appendChild(el(`<div class="feedback bad" style="margin:10px 0">${msg}</div>`));
      delBtn.disabled = false;
      delBtn.textContent = 'Удалить аккаунт';
      confirmStage = false;
    }
  };
  wrap.appendChild(dangerCard);

  return wrap;
}

/* ========================================================================
   FIREBASE: сохранение и загрузка прогресса
   ======================================================================== */
async function saveProgress(){
  if(!state.user || !state.user.uid) return;
  try{
    await setDoc(doc(db, 'users', state.user.uid), {
      name: state.user.name || '',
      email: state.user.email || '',
      stats: state.stats,
      catStats: state.catStats,
      mistakes: Array.from(state.mistakes),
      completedTests: state.completedTests,
      updatedAt: Date.now()
    }, {merge:true});
  } catch(e){ console.error('Не удалось сохранить прогресс:', e); }
}
async function loadProgress(uid){
  try{
    const snap = await getDoc(doc(db, 'users', uid));
    if(snap.exists()){
      const d = snap.data();
      if(d.stats) Object.assign(state.stats, d.stats);
      if(d.catStats) Object.assign(state.catStats, d.catStats);
      if(d.mistakes) state.mistakes = new Set(d.mistakes);
      if(d.completedTests) state.completedTests = d.completedTests;
    }
  } catch(e){ console.error('Не удалось загрузить прогресс:', e); }
}

/* ========================================================================
   TEST SCREEN
   ======================================================================== */
function renderTestScreen(){
  const t = state.test;
  const wrap = document.createElement('div');
  wrap.className = 'test-shell';
  if(t.idx >= t.questions.length){ wrap.appendChild(renderResult()); return wrap; }

  const back = el(`<a class="back-link" href="#">← Прервать и вернуться</a>`);
  back.onclick = (e) => { e.preventDefault(); setScreen(exitTarget()); };
  wrap.appendChild(back);

  const pct = Math.round((t.idx/t.questions.length)*100);
  const timerHtml = t.timed ? `<span class="timer-badge" id="examTimer">${Math.floor(t.timeLeft/60)}:${String(t.timeLeft%60).padStart(2,'0')}</span>` : '';
  wrap.appendChild(el(`<div class="test-progress"><span>Вопрос ${t.idx+1} из ${t.questions.length}${timerHtml}</span><span>Верно: ${t.correctCount}</span></div>`));
  wrap.appendChild(el(`<div class="test-progress-bar"><div class="fill" style="width:${pct}%"></div></div>`));

  const q = t.questions[t.idx];
  const card = document.createElement('div');
  card.className = 'question-card';
  if(q.img) card.appendChild(el(`<img class="qimg" src="${q.img}" alt="">`));
  card.appendChild(el(`<p class="qtext">${q.t}</p>`));

  const feedbackHolder = el(`<div></div>`);
  const controls = el(`<div class="controls"></div>`);

  if(q.ty === 'm'){
    const optsWrap = document.createElement('div');
    optsWrap.className = 'options';
    q.o.forEach((optText, i) => {
      const b = document.createElement('button');
      b.className = 'opt-btn';
      b.textContent = optText;
      b.onclick = () => handleMcqAnswer(i, optsWrap, feedbackHolder, controls, q);
      optsWrap.appendChild(b);
    });
    card.appendChild(optsWrap);
  } else {
    const form = el(`<div class="text-answer"><input type="text" placeholder="Впиши ответ..." autocomplete="off"><button class="btn">Ответить</button></div>`);
    const input = form.querySelector('input');
    const submit = () => handleTextAnswer(input.value, form, feedbackHolder, controls, q);
    form.querySelector('button').onclick = submit;
    input.addEventListener('keydown', (e) => { if(e.key === 'Enter') submit(); });
    card.appendChild(form);
    setTimeout(()=>input.focus(), 50);
  }

  card.appendChild(feedbackHolder);
  card.appendChild(controls);
  wrap.appendChild(card);
  return wrap;
}

function exitTarget(){
  const kind = state.test ? state.test.kind : 'home';
  if(kind === 'level') return 'levels';
  if(kind === 'ruler') return 'rulers';
  if(kind === 'period') return 'periods';
  if(kind === 'culture') return 'culture';
  if(kind === 'dates' || kind === 'random' || kind === 'mock' || kind === 'mistakes' || kind === 'custom') return 'general';
  return 'home';
}

function handleMcqAnswer(choiceIdx, optsWrap, feedbackHolder, controls, q){
  if(state.test.answeredCurrent) return;
  state.test.answeredCurrent = true;
  const correct = checkAnswer(q, choiceIdx);
  recordAnswer(q, correct);
  if(correct) state.test.correctCount++;
  [...optsWrap.children].forEach((btn, i) => {
    btn.disabled = true;
    if(i === q.a) btn.classList.add('correct');
    if(i === choiceIdx && !correct) btn.classList.add('wrong');
    if(i === choiceIdx) btn.classList.add('selected');
  });
  feedbackHolder.appendChild(el(correct ? `<div class="feedback ok">Верно!</div>` : `<div class="feedback bad">Неверно. Правильный ответ: ${q.o[q.a]}</div>`));
  addNextButton(controls);
  renderHeaderLevel();
}
function handleTextAnswer(value, form, feedbackHolder, controls, q){
  if(state.test.answeredCurrent) return;
  if(!value || !value.trim()) return;
  state.test.answeredCurrent = true;
  const correct = checkAnswer(q, value);
  recordAnswer(q, correct);
  if(correct) state.test.correctCount++;
  [...form.querySelectorAll('input,button')].forEach(elm => elm.disabled = true);
  feedbackHolder.appendChild(el(correct ? `<div class="feedback ok">Верно!</div>` : `<div class="feedback bad">Неверно. Правильный ответ: ${q.a}</div>`));
  addNextButton(controls);
  renderHeaderLevel();
}
function addNextButton(controls){
  const isLast = state.test.idx === state.test.questions.length - 1;
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = isLast ? 'Завершить тест' : 'Следующий вопрос';
  btn.onclick = () => { state.test.idx++; state.test.answeredCurrent = false; render(); };
  controls.appendChild(btn);
}
function renderResult(){
  const t = state.test;
  const total = t.questions.length;
  const pct = total ? Math.round((t.correctCount/total)*100) : 0;
  clearTestTimer();
  if(!t.recorded){
    t.recorded = true;
    state.completedTests.push({kind:t.kind, ctx:t.ctx, correct:t.correctCount, total});
    saveProgress(); // тихо сохраняем прогресс на сервер, если пользователь вошёл в аккаунт
  }
  const timeUp = t.timed && t.timeLeft<=0 && (t.results||[]).length < total;
  const wrap = el(`
    <div class="result-card">
      <div style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px">${timeUp ? 'Время вышло' : 'Тест завершён'}</div>
      <div class="score">${t.correctCount} / ${(t.results||[]).length || total}</div>
      <p>${pct}% правильных ответов. Твой общий уровень подготовки обновлён — загляни во вкладку «Профиль».</p>
      <div id="resultBreakdown"></div>
      <div class="actions" style="display:flex;gap:10px;justify-content:center;margin-top:14px;flex-wrap:wrap">
        <button class="btn">Пройти ещё раз</button>
        <button class="btn outline">Назад</button>
        <button class="btn outline">Профиль</button>
      </div>
    </div>
  `);
  if(t.kind === 'mock' && t.results && t.results.length){
    const byCat = {};
    t.results.forEach(r => { byCat[r.cat] = byCat[r.cat] || {a:0,c:0}; byCat[r.cat].a++; if(r.correct) byCat[r.cat].c++; });
    const rows = CATS.filter(c=>byCat[c]).map(c => `<tr><td>${CAT_LABEL[c]}</td><td class="num">${byCat[c].c} / ${byCat[c].a}</td></tr>`).join('');
    wrap.querySelector('#resultBreakdown').appendChild(el(`
      <table class="stats-table" style="margin:18px 0;text-align:left"><thead><tr><th>Раздел</th><th>Верно</th></tr></thead><tbody>${rows}</tbody></table>
    `));
  }
  const [again, back, prog] = wrap.querySelectorAll('.actions button');
  again.onclick = () => {
    const kind = t.kind, ctx = t.ctx;
    if(kind==='level') startLevelTest(ctx);
    else if(kind==='ruler') startRulerTest(ctx);
    else if(kind==='period') startPeriodTest(ctx);
    else if(kind==='culture') startCultureTest();
    else if(kind==='dates') startDatesTest();
    else if(kind==='mock') startMockExam();
    else if(kind==='mistakes') startMistakesTest();
    else if(kind==='custom') startCustomTest();
    else startRandomTest();
  };
  back.onclick = () => setScreen(exitTarget());
  prog.onclick = () => setScreen('profile');
  return wrap;
}

render(); // первая отрисовка — гостевой вид, пока Firebase проверяет сессию

// Как только Firebase узнаёт, вошёл ли пользователь (это происходит
// асинхронно, обычно доли секунды) — подгружаем его прогресс и перерисовываем.
onAuthStateChanged(auth, async (user) => {
  if(user){
    state.user = {
      uid: user.uid,
      name: user.displayName || (user.email ? user.email.split('@')[0] : 'Гость'),
      email: user.email || ''
    };
    await loadProgress(user.uid);
  } else {
    state.user = null;
  }
  render();
});

// Некоторые кнопки вызываются напрямую из HTML (onclick="..."),
// поэтому явно делаем их доступными глобально — иначе ES-модули их спрячут.
window.setScreen = setScreen;
window.startMockExam = startMockExam;
