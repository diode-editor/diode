import { Module } from "node:module";
import * as path from "node:path";

/**
 * Динамический `import()` файла с ФС, работающий и под SEA.
 *
 * Прямой `import()` из вшитого SEA-main перехватывается embedder-хуком и умеет
 * только builtin'ы (`ERR_UNKNOWN_BUILTIN_MODULE`), а `require(esm)` не берёт
 * модули с top-level await. Обход один и тот же на всех потребителей: `import()`
 * вызывается из СИНТЕТИЧЕСКОГО CJS-модуля, скомпилированного в памяти
 * (`Module._compile`) — оттуда загрузка идёт настоящим ESM-loader'ом и одинаково
 * берёт ESM (включая top-level await) и CJS.
 *
 * `filename` синтетического модуля — путь самого целевого файла: так
 * относительный `require` внутри (и стек-трейсы) смотрят туда же, куда смотрел
 * бы настоящий модуль.
 *
 * Потребители: `runAsNode` (diode как node для language-серверов) и загрузка
 * ESM-расширений в extension host.
 */
export async function importModule(filePath: string): Promise<unknown> {
    const source =
        'const { pathToFileURL } = require("node:url");\n' +
        `module.exports = import(pathToFileURL(${JSON.stringify(filePath)}).href);\n`;
    type CompilableModule = InstanceType<typeof Module> & { _compile(source: string, filename: string): void };
    const shim = new Module(filePath) as CompilableModule;
    shim.filename = filePath;
    shim.paths = (Module as unknown as { _nodeModulePaths(dir: string): string[] })._nodeModulePaths(
        path.dirname(filePath),
    );
    shim._compile(source, filePath);
    return (await shim.exports) as unknown;
}
