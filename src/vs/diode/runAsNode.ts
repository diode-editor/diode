import { Module } from "node:module";
import * as path from "node:path";

import { importModule } from "../base/node/importModule.ts";

/**
 * Калька `ELECTRON_RUN_AS_NODE`: в SEA `process.execPath` — сам diode, и language-серверы с внуками
 * (tsserver через `fork`) запускаются нашим бинарём без node в PATH. Сигнал — env: он наследуется
 * fork'ами, а argv-флаг во внучьи спавны не вставить.
 *
 * Ведущие `--*` пропускаются: SEA не умеет node-флаги (`--max-old-space-size` игнорируется; при
 * надобности — трансляция в NODE_OPTIONS). Исключение — `-e`/`--eval`.
 */
export function runAsNode(): void {
    // Под SEA argv[1] — плейсхолдер вшитого main.
    const args = process.argv.slice(2);
    let scriptIndex = 0;
    while (scriptIndex < args.length && (args[scriptIndex].startsWith("--") || args[scriptIndex] === "-e")) {
        // Как у node: CJS-модуль в cwd, argv без слота скрипта. Так `Files.resolve()` vscode-languageserver'а
        // ищет библиотеку линтера в проекте (проверено стоковым eslint).
        if (args[scriptIndex] === "-e" || args[scriptIndex] === "--eval") {
            const code = args.at(scriptIndex + 1);
            if (code === undefined) {
                process.stderr.write("diode (run-as-node): -e requires an argument\n");
                process.exit(9);
            }
            process.argv = [process.argv[0], ...args.slice(scriptIndex + 2)];
            const evalPath = path.join(process.cwd(), "[eval]");
            type CompilableEvalModule = InstanceType<typeof Module> & {
                _compile(source: string, filename: string): void;
            };
            const evalModule = new Module("[eval]") as CompilableEvalModule;
            evalModule.filename = evalPath;
            evalModule.paths = (Module as unknown as { _nodeModulePaths(dir: string): string[] })._nodeModulePaths(
                process.cwd(),
            );
            evalModule._compile(code, evalPath);
            return;
        }
        scriptIndex++;
    }
    const script = args.at(scriptIndex);
    if (script === undefined) {
        process.stderr.write("diode (run-as-node): no script path in argv\n");
        process.exit(9); // как node: exit 9 = invalid argument
    }
    const scriptPath = path.resolve(script);

    // argv[1] — путь скрипта: на него смотрят commander в cli.mjs и `sys.getExecutingFilePath()` tsserver'а.
    process.argv = [process.argv[0], scriptPath, ...args.slice(scriptIndex + 1)];

    void importModule(scriptPath).catch((err: unknown) => {
        console.error(err);
        process.exit(1);
    });
}
