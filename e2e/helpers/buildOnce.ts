import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..", "..");
const binaryName = process.platform === "win32" ? "diode.exe" : "diode";
const binaryPath = resolve(repoRoot, "dist", binaryName);

const selfExtractPath = resolve(repoRoot, "dist", "diode-selfextract");

let buildPromise: Promise<string> | null = null;
let selfExtractPromise: Promise<string> | null = null;

/**
 * Путь к SEA-бинарю; собирает его лениво только вне `test:e2e`.
 *
 * Под `test:e2e` бинарь собирает `globalSetup` ДО старта воркеров и отдаёт путь
 * через `DIODE_E2E_BINARY` (форки наследуют env). Воркер при этом не собирает
 * НИКОГДА — даже если файла по пути нет: сборка в воркере — это tsup `clean`
 * по всему `dist/` и перезапись `dist/diode`, который в этот момент исполняют
 * соседние воркеры (ENOENT/ETXTBSY и 30-секундные таймауты в случайных файлах,
 * см. docs/TODO/TestRunTime.md). Пропавший бинарь — ошибка с понятной причиной.
 *
 * Ленивая сборка `npm run build:sea` остаётся только для запусков без
 * globalSetup (`npm run screenshots`, бенчи), где env не задан.
 */
export function getBinaryPath(): Promise<string> {
    buildPromise ??= resolveInjected("DIODE_E2E_BINARY") ?? build(["run", "build:sea"], binaryPath);
    return buildPromise;
}

/**
 * Путь к self-extracting бинарю (#144); правила те же, что у {@link getBinaryPath}:
 * под `test:e2e` его собирает globalSetup (`DIODE_E2E_SELFEXTRACT`).
 *
 * `--node=host` берёт `process.execPath` вместо скачивания тарбола с nodejs.org:
 * тестам не нужен именно релизный node, а сеть в e2e — лишняя точка отказа.
 * Ветку со скачиванием покрывает реальная сборка в CI.
 *
 * Пишем в `dist/diode-selfextract`, чтобы не затирать SEA-бинарь `dist/diode`.
 */
export function getSelfExtractPath(): Promise<string> {
    selfExtractPromise ??= resolveInjected("DIODE_E2E_SELFEXTRACT") ?? buildSelfExtract();
    return selfExtractPromise;
}

/**
 * Сборка self-extract для globalSetup и для ленивого пути. `reuseDist` — взять
 * `dist/main.js` и бандлы, только что собранные `build:sea`, без второго tsup:
 * его `clean` снёс бы и сам SEA-бинарь.
 */
export function buildSelfExtract(options: { reuseDist?: boolean } = {}): Promise<string> {
    const args = ["run", "build:selfextract", "--", "--node=host", `--out=${selfExtractPath}`];
    if (options.reuseDist === true) args.push("--reuse-dist");
    return build(args, selfExtractPath);
}

/** Путь из env, если он задан; заданный, но пропавший файл — ошибка, а не пересборка. */
function resolveInjected(envName: string): Promise<string> | undefined {
    const injected = process.env[envName];
    if (injected === undefined || injected.length === 0) return undefined;
    if (!existsSync(injected)) {
        return Promise.reject(
            new Error(
                `${envName}=${injected}: файла нет. Под test:e2e его собирает globalSetup до воркеров — ` +
                    `пропал посреди прогона, значит снесла параллельная сборка в этом же дереве ` +
                    `(build:sea / build:selfextract / tsup). Воркер сам не пересобирает: это сломало бы соседей.`,
            ),
        );
    }
    return Promise.resolve(injected);
}

function build(npmArgs: string[], expectedPath: string): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
        const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
        const child = spawn(npmCmd, npmArgs, {
            cwd: repoRoot,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, CI: "1" },
            shell: process.platform === "win32",
        });
        let stderr = "";
        let stdout = "";
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
            process.stderr.write(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
            process.stderr.write(chunk);
        });
        child.on("error", rejectPromise);
        child.on("exit", (code) => {
            const label = `npm ${npmArgs.join(" ")}`;
            if (code !== 0) {
                rejectPromise(new Error(`${label} failed with code ${String(code)}\n${stderr || stdout}`));
                return;
            }
            if (!existsSync(expectedPath)) {
                rejectPromise(new Error(`${label} succeeded but binary missing: ${expectedPath}`));
                return;
            }
            resolvePromise(expectedPath);
        });
    });
}
