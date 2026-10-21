import { Module } from "node:module";
import * as path from "node:path";

import { importModule } from "../base/node/importModule.ts";

/**
 * Counterpart of `ELECTRON_RUN_AS_NODE`: under SEA `process.execPath` is diode itself, and language servers with
 * child processes (tsserver via `fork`) run on our binary with no node in PATH. The signal is an env var: forks
 * inherit it, while an argv flag can't be injected into grandchild spawns.
 *
 * Leading `--*` flags are skipped: SEA does not support node flags (`--max-old-space-size` is ignored; if
 * needed, translate them to NODE_OPTIONS). The exception is `-e`/`--eval`.
 */
export function runAsNode(): void {
    // Under SEA argv[1] is the placeholder of the embedded main.
    const args = process.argv.slice(2);
    let scriptIndex = 0;
    while (scriptIndex < args.length && (args[scriptIndex].startsWith("--") || args[scriptIndex] === "-e")) {
        // Like node: a CJS module in cwd, argv without a script slot. This way vscode-languageserver's `Files.resolve()`
        // finds the linter library in the project (checked with stock eslint).
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
        process.exit(9); // like node: exit 9 = invalid argument
    }
    const scriptPath = path.resolve(script);

    // argv[1] is the script path: commander in cli.mjs and tsserver's `sys.getExecutingFilePath()` read it.
    process.argv = [process.argv[0], scriptPath, ...args.slice(scriptIndex + 1)];

    void importModule(scriptPath).catch((err: unknown) => {
        console.error(err);
        process.exit(1);
    });
}
