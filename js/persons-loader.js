// ============================================================================
// Загрузчик модулей личностей. Как и dates-loader.js — сам находит все
// файлы data/persons/module-01.json и далее. Новый модуль — просто кладём
// файл в папку, в коде ничего менять не надо.
// ============================================================================

export async function discoverPersonModules(maxNum = 60){
  const tries = [];
  for(let i = 1; i <= maxNum; i++){
    const num = String(i).padStart(2, '0');
    const file = `data/persons/module-${num}.json`;
    tries.push(
      fetch(file)
        .then(r => (r.ok ? r.json() : null))
        .then(data => (data && data.persons ? {num, file, title: data.title || `Модуль ${num}`, persons: data.persons} : null))
        .catch(() => null)
    );
  }
  const results = await Promise.all(tries);
  return results.filter(Boolean);
}
