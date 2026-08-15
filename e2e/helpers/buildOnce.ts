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
 * Lazily build the SEA binary and return its absolute path.
 *
 * When `globalSetup` has already built it, its path arrives via
 * `VEXX_E2E_BINARY` (inherited by every worker fork) — we skip the build. Only
 * the fallback path (no global setup, e.g. `npm run screenshots` or a single
 * file run) triggers `npm run build:sea`, at most once per worker.
 */
export function getBinaryPath(): Promise<string> {
    if (buildPromise) return buildPromise;
    const injected = process.env.VEXX_E2E_BINARY;
    if (injected !== undefined && injected.length > 0 && existsSync(injected)) {
        buildPromise = Promise.resolve(injected);
        return buildPromise;
    }
    buildPromise = build(["run", "build:sea"], binaryPath);
    return buildPromise;
}

/**
 * Lazily build the self-extracting binary (#144) and return its absolute path.
 *
 * `--node=host` берёт `process.execPath` вместо скачивания тарбола с nodejs.org:
 * тестам не нужен именно релизный node, а сеть в e2e — лишняя точка отказа.
 * Ветку со скачиванием покрывает реальная сборка в CI.
 *
 * Пишем в `dist/diode-selfextract`, чтобы не затирать SEA-бинарь `dist/diode`,
 * от которого зависят соседние sea-*.test.ts.
 */
export function getSelfExtractPath(): Promise<string> {
    if (selfExtractPromise) return selfExtractPromise;
    selfExtractPromise = build(
        ["run", "build:selfextract", "--", "--node=host", `--out=${selfExtractPath}`],
        selfExtractPath,
    );
    return selfExtractPromise;
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
