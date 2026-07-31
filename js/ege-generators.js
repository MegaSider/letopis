// ============================================================================
// Генератор задания №1 ЕГЭ («установите соответствие между событиями и
// годами») из общей базы дат. Берёт 4 случайных события с точно известным
// годом + 2 года-«обманки» из других событий, перемешивает порядок показа
// и считает правильный ответ вида "3142". Каждый вызов — новая комбинация,
// поэтому вариантов практически бесконечно много, пока растёт база дат.
//
// Генератор задания №2 («расположите в хронологическом порядке») работает
// так же, но берёт всего 3 события и вместо сопоставления считает порядок
// по годам. Как в реальном ЕГЭ, обычно смешивает историю России и
// всемирную историю (2 российских + 1 всемирная), но с шансом 1 к 10
// берёт все 3 из истории России, и ещё с шансом 1 к 10 — 2 всемирных +
// 1 российское.
// ============================================================================
import { discoverDateModules } from './dates-loader.js';

let eventsCache = null;
let worldEventsCache = null;

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; }
  return a;
}

async function getUsableEvents(){
  if(eventsCache) return eventsCache;
  const mods = await discoverDateModules();
  const events = [];
  mods.forEach(mod => {
    mod.events.forEach(ev => {
      // берём только события с точным, однозначным годом — иначе
      // сопоставление "событие → год" не будет иметь единственно
      // верного ответа
      if(ev.precision === 'year' && ev.yearStart != null && ev.text) {
        events.push(ev);
      }
    });
  });
  eventsCache = events;
  return events;
}

// Для задания 2 (просто порядок, не точный год) подходят и диапазоны —
// сортируем по году начала события, как принято в реальном ЕГЭ.
async function getOrderableRussianEvents(){
  const mods = await discoverDateModules();
  const events = [];
  const okPrecision = new Set(['year','range','approx','since','decade','decade-part','multi-year']);
  mods.forEach(mod => {
    mod.events.forEach(ev => {
      if(okPrecision.has(ev.precision) && ev.yearStart != null && ev.text) events.push(ev);
    });
  });
  return events;
}

async function getOrderableWorldEvents(){
  if(worldEventsCache) return worldEventsCache;
  try{
    const res = await fetch('data/world-dates.json');
    if(!res.ok) { worldEventsCache = []; return worldEventsCache; }
    const data = await res.json();
    worldEventsCache = (data.events || []).filter(ev => ev.yearStart != null && ev.text);
  } catch(e){
    worldEventsCache = [];
  }
  return worldEventsCache;
}


export async function generateTask1(){
  const events = await getUsableEvents();
  if(events.length < 8) return null; // базе ещё рано — вопросов маловато для честной генерации

  const pool = shuffle(events);

  // 4 события с ГАРАНТИРОВАННО разными годами (иначе сопоставление станет
  // неоднозначным — два события с одним годом нельзя корректно развести
  // по отдельным пунктам А/Б/В/Г)
  const chosen = [];
  const usedYears = new Set();
  for(const ev of pool){
    if(chosen.length >= 4) break;
    if(usedYears.has(ev.yearStart)) continue;
    chosen.push(ev);
    usedYears.add(ev.yearStart);
  }
  if(chosen.length < 4) return null;

  // 2 года-«обманки» — реальные годы других событий, которых нет среди
  // уже выбранных 4 (чтобы не получилось два правильных варианта на одно число)
  const distractors = [];
  const usedDistractorYears = new Set();
  for(const ev of pool){
    if(distractors.length >= 2) break;
    if(usedYears.has(ev.yearStart) || usedDistractorYears.has(ev.yearStart)) continue;
    distractors.push(ev.yearStart);
    usedDistractorYears.add(ev.yearStart);
  }
  if(distractors.length < 2) return null;

  const optionYears = shuffle([...chosen.map(ev => ev.yearStart), ...distractors]);
  const eventsOrder = shuffle(chosen);
  const letters = ['А', 'Б', 'В', 'Г'];

  let answer = '';
  const eventRows = eventsOrder.map((ev, i) => {
    const optionIndex = optionYears.indexOf(ev.yearStart);
    answer += String(optionIndex + 1);
    return `<tr><td>${letters[i]}) ${ev.text}</td></tr>`;
  }).join('');
  const optionsList = optionYears.map((y, i) => `${i+1}) ${y} г.`).join('<br>');

  const context = `<table class="ege-table"><tr><th>СОБЫТИЯ</th><th>ГОДЫ</th></tr>
    <tr><td>${letters[0]}) ${eventsOrder[0].text}</td><td rowspan="4" style="vertical-align:top">${optionsList}</td></tr>
    <tr><td>${letters[1]}) ${eventsOrder[1].text}</td></tr>
    <tr><td>${letters[2]}) ${eventsOrder[2].text}</td></tr>
    <tr><td>${letters[3]}) ${eventsOrder[3].text}</td></tr>
  </table>`;

  return {
    n: 1, part: 1, type: 'seq', points: 2,
    prompt: 'Установите соответствие между событиями и годами: к каждой позиции первого столбца подберите соответствующую позицию из второго столбца. Запишите ответ последовательностью цифр без пробелов (например: 3142).',
    context,
    answer
  };
}

// Выбирает N событий с гарантированно НЕ пересекающимися по времени
// диапазонами (иначе хронологический порядок может быть спорным даже
// для системы — например, событие "980-е гг." и событие "985 г." могут
// в реальности идти в любом порядке относительно друг друга).
function pickNonOverlapping(pool, n){
  const shuffled = shuffle(pool);
  const chosen = [];
  for(const ev of shuffled){
    if(chosen.length >= n) break;
    const overlaps = chosen.some(c => ev.yearStart <= c.yearEnd + 2 && c.yearStart <= ev.yearEnd + 2);
    if(overlaps) continue;
    chosen.push(ev);
  }
  return chosen.length >= n ? chosen.slice(0, n) : null;
}

export async function generateTask2(){
  const [russianEvents, worldEvents] = await Promise.all([
    getOrderableRussianEvents(),
    getOrderableWorldEvents()
  ]);
  if(russianEvents.length < 6) return null;

  // распределение как в реальном ЕГЭ: обычно 2 российских + 1 всемирная,
  // изредка (1 к 10) все 3 российских, изредка (1 к 10) 2 всемирных + 1 российская
  const roll = Math.random();
  let russianCount, worldCount;
  if(roll < 0.1 || worldEvents.length < 3){ russianCount = 3; worldCount = 0; }
  else if(roll < 0.2){ russianCount = 1; worldCount = 2; }
  else { russianCount = 2; worldCount = 1; }

  const chosenRussian = pickNonOverlapping(russianEvents, russianCount);
  if(!chosenRussian) return null;
  let chosenWorld = [];
  if(worldCount > 0){
    chosenWorld = pickNonOverlapping(worldEvents, worldCount);
    if(!chosenWorld) return null;
  }

  const combined = shuffle([...chosenRussian, ...chosenWorld]);
  const answer = combined
    .map((ev, i) => ({ i: i + 1, y: ev.yearStart }))
    .sort((a, b) => a.y - b.y)
    .map(x => x.i)
    .join('');

  const listItems = combined.map(ev => `<li>${ev.text}</li>`).join('');
  const context = `<ol class="ege-list">${listItems}</ol>`;

  return {
    n: 2, part: 1, type: 'seq', points: 1,
    prompt: 'Расположите в хронологической последовательности исторические события. Запишите цифры, которыми обозначены исторические события, в правильной последовательности.',
    context,
    answer
  };
}
