import { createRequire } from "node:module";
import * as path from "node:path";

/**
 * Режим «vexx как node» (`VEXX_RUN_AS_NODE=1`): бинарь исполняет внешний
 * JS-скрипт вместо запуска редактора — калька `ELECTRON_RUN_AS_NODE`
 * VS Code/Electron. Нужен SEA-поставке, где `process.execPath` — сам vexx:
 * language-серверы (typescript-language-server) и их внуки (tsserver форкается
 * сервером через `child_process.fork` → `process.execPath`) запускаются нашим
 * бинарём без node в PATH. Сигнал — env (наследуется fork'ами автоматически;
 * argv-флаг вставить во внучьи спавны невозможно), путь скрипта — argv.
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

    // Единый путь загрузки — createRequire: динамический import() внешнего файла
    // в SEA перехватывается embedder-хуком и умеет только builtin'ы
    // (ERR_UNKNOWN_BUILTIN_MODULE — проверено на настоящем бинаре). require(esm)
    // (Node >= 22) синхронно грузит и .mjs без top-level await; createRequire от
    // пути скрипта даёт правильный резолв соседей (прецедент SEA — user-расширения).
    createRequire(scriptPath)(scriptPath);
}
