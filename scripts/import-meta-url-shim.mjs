// `import.meta.url` для CJS-сборок (esbuild `inject` + `define`): без шима esbuild
// делает `import.meta` пустым объектом, и `createRequire(undefined)` бросает.
//
// Значение — `require.main.filename`: в SEA путь бинаря, иначе `main.cjs`, рядом с
// которым лежат ассеты и куски. Не `__filename`: кусок исполняется не своим файлом
// (`diode:lazy/<id>.cjs`). Не `process.argv[1]`: в SEA это имя вызова, а run-as-node
// переписывает его на путь чужого скрипта.
//
// Геттер, а не константа: константа уровня модуля запеклась бы в V8-снапшот.
export const __diode_import_meta = {
    get url() {
        const { pathToFileURL } = process.getBuiltinModule("node:url");
        return pathToFileURL(require.main?.filename ?? process.execPath).href;
    },
};
