// ============================================================================
// Загрузчик модулей дат. Сам находит все файлы data/dates/module-01.json,
// module-02.json и т.д. — сколько бы их ни было. Новый модуль достаточно
// просто положить в папку data/dates/ с правильным именем, ничего в коде
// менять не нужно.
// ============================================================================

export async function discoverDateModules(maxNum = 60){
  const tries = [];
  for(let i = 1; i <= maxNum; i++){
    const num = String(i).padStart(2, '0');
    const file = `data/dates/module-${num}.json`;
    tries.push(
      fetch(file)
        .then(r => (r.ok ? r.json() : null))
        .then(data => (data && data.events ? {num, file, title: data.title || `Модуль ${num}`, events: data.events} : null))
        .catch(() => null)
    );
  }
  const results = await Promise.all(tries);
  return results.filter(Boolean);
}
