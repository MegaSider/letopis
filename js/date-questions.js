// ============================================================================
// Превращает базу дат (data/dates/module-XX.json) в вопросы для тестов —
// «в каком году произошло...». Подключается один раз при загрузке сайта,
// дальше эти вопросы можно подмешивать в любые тесты и в конструктор.
//
// Важно: у этих вопросов нет откалиброванного уровня A1–C2 (lvl: null) —
// их слишком много, чтобы вручную проставить сложность каждому. Поэтому
// они не участвуют в тестах «по уровню» и не влияют на подсчёт уровня
// подготовки — только на статистику по разделу «Даты» и на сами тесты,
// где это уместно (Тест на даты, Полный рандом, Конструктор, Пробник ЕГЭ).
// ============================================================================
import { discoverDateModules } from './dates-loader.js';

export const generatedDateQuestions = [];
let loadPromise = null;

export function ensureDateQuestionsLoaded(){
  if(loadPromise) return loadPromise;
  loadPromise = discoverDateModules().then(mods => {
    mods.forEach(mod => {
      mod.events.forEach(ev => {
        // берём только события с однозначным, точно известным годом —
        // диапазоны и «около»/«конец века» не дают чёткого правильного ответа
        if(ev.precision !== 'year' || ev.yearStart == null) return;
        generatedDateQuestions.push({
          id: 'gd-' + ev.id,
          t: `В каком году произошло следующее событие: «${ev.text}»?`,
          ty: 't',
          o: null,
          a: String(ev.yearStart),
          lvl: null,
          cat: 'date',
          ref: mod.num,
          img: null,
          alt: []
        });
      });
    });
    return generatedDateQuestions;
  });
  return loadPromise;
}
