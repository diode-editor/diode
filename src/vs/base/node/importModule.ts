import { Module } from "node:module";
import * as path from "node:path";

/**
 * Обход SEA: прямой `import()` из вшитого main умеет только builtin'ы, а
 * `require(esm)` не берёт top-level await. `import()` из синтетического
 * CJS-модуля (`Module._compile`) идёт настоящим ESM-loader'ом. `filename` —
 * путь целевого файла, чтобы относительный `require` смотрел туда же.
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
