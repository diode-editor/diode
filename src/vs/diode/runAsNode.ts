import { Module } from "node:module";
import * as path from "node:path";

/**
 * Режим «vexx как node» (`DIODE_RUN_AS_NODE=1`): бинарь исполняет внешний
 * JS-скрипт вместо запуска редактора — калька `ELECTRON_RUN_AS_NODE`
 * VS Code/Electron. Нужен SEA-поставке, где `process.execPath` — сам vexx:
 * language-серверы (typescript-language-server) и их внуки (tsserver форкается
 * сервером через `child_process.fork` → `process.execPath`) запускаются нашим
 * бинарём без node в PATH. Сигнал — env (наследуется fork'ами автоматически;
 * argv-флаг вставить во внучьи спавны невозможно), путь скрипта — argv.
 *
 * Механика загрузки (варианты проверены на настоящем SEA-бинаре):
 * динамический `import()` из вшитого SEA-main перехватывается embedder-хуком и
 * умеет только builtin'ы (ERR_UNKNOWN_BUILTIN_MODULE), а `require(esm)` не
 * берёт модули с top-level await (у `cli.mjs` сервера он есть) — поэтому
 * скрипт грузится `import()`-ом из СИНТЕТИЧЕСКОГО CJS-модуля, скомпилированного
 * в памяти (`Module._compile`, прецедент — загрузка builtin-расширений в
 * subprocess): оттуда import идёт настоящим ESM-loader'ом и одинаково берёт
 * ESM (включая top-level await) и CJS.
 *
 * Ограничение: ведущие `--*`-аргументы пропускаются без интерпретации — SEA не
 * умеет node-флаги из командной строки (`--max-old-space-size` от
 * `maxTsServerMemory` игнорируется; при надобности — трансляция в NODE_OPTIONS).
 */
export function runAsNode(): void {
    // Под SEA argv[1] — плейсхолдер вшитого main; пользовательские аргументы —
    // argv.slice(2) (та же арифметика, что у parseCliArgs редакторной ветки).
    const args = process.argv.slice(2);
    let scriptIndex = 0;
    while (scriptIndex < args.length && args[scriptIndex].startsWith("--")) scriptIndex++;
    const script = args[scriptIndex];
    if (script === undefined) {
        process.stderr.write("vexx (run-as-node): no script path in argv\n");
        process.exit(9); // как node: exit 9 = invalid argument
    }
    const scriptPath = path.resolve(script);

    // Скрипт и его форки должны видеть мир как обычный node: argv[1] — путь
    // скрипта (на это смотрят commander в cli.mjs и sys.getExecutingFilePath()
    // tsserver'а), argv без наших пропущенных флагов.
    process.argv = [process.argv[0], scriptPath, ...args.slice(scriptIndex + 1)];

    const shimSource =
        'const { pathToFileURL } = require("node:url");\n' +
        `import(pathToFileURL(${JSON.stringify(scriptPath)}).href).catch((err) => {\n` +
        "    console.error(err);\n" +
        "    process.exit(1);\n" +
        "});\n";
    type CompilableModule = InstanceType<typeof Module> & { _compile(source: string, filename: string): void };
    const shim = new Module(scriptPath) as CompilableModule;
    shim.filename = scriptPath;
    shim.paths = (Module as unknown as { _nodeModulePaths(dir: string): string[] })._nodeModulePaths(
        path.dirname(scriptPath),
    );
    shim._compile(shimSource, scriptPath);
}
