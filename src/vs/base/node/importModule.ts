import { Module } from "node:module";
import * as path from "node:path";

/**
 * SEA workaround: a bare `import()` from the embedded main only handles builtins, and
 * `require(esm)` doesn't support top-level await. `import()` from a synthetic
 * CJS module (`Module._compile`) goes through the real ESM loader. `filename` is
 * the target file's path so a relative `require` resolves from there too.
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
