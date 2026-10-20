// `import.meta.url` для CJS-сборок: ядро `dist/main.cjs` (tsup.config.ts) и ленивые
// куски из нашего кода (build-lazy-chunks.mjs). Подключается через esbuild
// `inject` вместе с `define: { "import.meta.url": "__diode_import_meta.url" }`
// (IMPORT_META_URL_SHIM в build-lazy-chunks.mjs). Без шима esbuild в CJS делает
// `import.meta` пустым объектом, и `createRequire(undefined)` бросает.
//
// Значение — URL главного скрипта процесса, `require.main.filename`:
//   - SEA — путь бинаря (как и `import.meta.url` ESM-ядра раньше);
//   - `node <dist>/main.cjs`, self-extract, роли процесса (`node <main.cjs>`) —
//     путь `main.cjs`: рядом с ним лежат ассеты и куски (entryDir()).
// Кусок исполняется не своим файлом (`diode:lazy/<id>.cjs`), поэтому `__filename`
// не годится: `require` куска — от `createRequire`, его `main` — тот же главный
// модуль. `process.argv[1]` тоже нет: в SEA это имя вызова (`diode`, `./diode`),
// а run-as-node переписывает его на путь чужого скрипта.
//
// Геттер, а не константа: значение считается в момент вызова. Константа уровня
// модуля запеклась бы при сборке V8-снапшота (docs/arch/Common.md, «Верхний уровень модулей и V8-снапшот»).
export const __diode_import_meta = {
    get url() {
        const { pathToFileURL } = process.getBuiltinModule("node:url");
        return pathToFileURL(require.main?.filename ?? process.execPath).href;
    },
};
