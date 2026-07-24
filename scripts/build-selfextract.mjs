/**
 * Сборка самораспаковывающегося однофайлового бинаря (makeself-подход).
 * Формат склейки стаба и payload'а — в `selfextract-format.mjs`.
 *
 * Зачем: Node SEA на Intel macOS не работает — инъекция SEA-блоба портит Mach-O
 * chained fixups, и бинарь падает с segfault в статических инициализаторах ДО main()
 * (#143). Апстрим считает SEA на x64 macOS неподдерживаемым (nodejs/node#62893).
 * Здесь никакой хирургии над Mach-O нет: берём нетронутый node с nodejs.org и
 * приклеиваем к sh-стабу payload — баг не воспроизводится, а codesign не нужен
 * (официальный node уже подписан и нотаризован).
 *
 * Результат:
 *
 *     [ #!/bin/sh стаб (scripts/selfextract-stub.sh) ][ payload.tar.gz ]
 *       payload = node + main.js + vexx.bundle
 *
 * Стаб при первом запуске распаковывает payload в
 * `${XDG_CACHE_HOME:-~/.cache}/vexx/<key>/` и делает `exec node main.js "$@"`.
 * Не-SEA чтение `vexx.bundle` рядом с `main.js` обеспечивает
 * `src/Common/Assets/BundleFile.ts`.
 *
 * Использование:
 *
 *     node scripts/build-selfextract.mjs [--target=<platform>-<arch>] [--node=host|<path>] [--out=<path>]
 *
 *   --target  платформа payload'а (по умолчанию — хост). darwin-x64 | darwin-arm64 | linux-x64 | linux-arm64
 *   --node    `host` — взять process.execPath (быстро, без сети: локальные сборки и e2e);
 *             путь — взять указанный бинарь; по умолчанию — скачать официальный тарбол.
 *   --out     путь результата (по умолчанию dist/vexx)
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { buildDistArtifacts } from "./build-dist.mjs";
import { buildNodePtyBundle } from "./pack-node-pty.mjs";
import { resolveVexxVersion } from "./resolve-version.mjs";
import { writeSelfExtract } from "./selfextract-format.mjs";
import { smokeTestBinary } from "./smoke-binary.mjs";

/**
 * Версия Node, уезжающая в payload. Держи в лок-степе с `node-version` в
 * `.github/workflows/build.yml` — там setup-node для сборки, здесь runtime юзера.
 */
const NODE_VERSION = "25.9.0";

const SUPPORTED_TARGETS = new Set(["darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"]);
const HOST_TARGET = `${process.platform}-${process.arch}`;

const root = resolve(import.meta.dirname, "..");

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const target = args.target ?? HOST_TARGET;
    if (!SUPPORTED_TARGETS.has(target)) {
        // Windows сюда не заводится сознательно: стаб — POSIX sh.
        throw new Error(`[selfextract] Unsupported target: ${target}. Supported: ${[...SUPPORTED_TARGETS].join(", ")}`);
    }

    const outputPath = resolve(root, args.out ?? join("dist", "vexx"));
    const version = resolveVexxVersion({ repoRoot: root });
    console.log(`[selfextract] target=${target} version=${version}`);

    // 1. dist/main.js + dist/vexx.bundle (общее с build-sea.mjs).
    const { mainJsPath, bundlePath } = await buildDistArtifacts({ repoRoot: root });

    // 2. node для payload'а.
    const nodeBinary = await resolveNodeBinary({ target, nodeOpt: args.node });

    // 3. Стейджим payload и жмём его.
    const payload = buildPayload({ target, nodeBinary, mainJsPath, bundlePath });

    // 4. Клеим стаб + payload.
    const key = `${version}-${sha256(payload).slice(0, 12)}`;
    writeSelfExtract({ outputPath, payload, key });

    const sizeMb = (payload.length / 1024 / 1024).toFixed(1);
    console.log(`[selfextract] ${outputPath} (payload ${sizeMb} MB, cache key ${key})`);

    // 5. Самотест — тот же, что у SEA: бинарь обязан реально стартовать (#143).
    if (target === HOST_TARGET) {
        const reported = smokeTestBinary(outputPath, { cwd: root });
        console.log(`[selfextract] Smoke: ${outputPath} --version → ${reported}`);
        // Версия, зашитая в main.js, обязана совпадать с версией в ключе кэша: иначе
        // распаковка ведётся в каталог, не соответствующий содержимому payload'а.
        if (reported !== version) {
            throw new Error(
                `[selfextract] Version mismatch: binary reports "${reported}", cache key built from "${version}".\n` +
                    `  Обе стороны обязаны идти из scripts/resolve-version.mjs.`,
            );
        }
    } else {
        console.log(`[selfextract] Smoke skipped: target ${target} != host ${HOST_TARGET}`);
    }
}

/** @param {string[]} argv */
function parseArgs(argv) {
    /** @type {{ target?: string, node?: string, out?: string }} */
    const args = {};
    for (const arg of argv) {
        const match = /^--(target|node|out)=(.+)$/.exec(arg);
        if (!match) throw new Error(`[selfextract] Unknown argument: ${arg}`);
        args[match[1]] = match[2];
    }
    return args;
}

/**
 * Отдаёт путь к бинарю node, который уедет в payload.
 * @param {{ target: string, nodeOpt: string | undefined }} params
 * @returns {Promise<string>}
 */
async function resolveNodeBinary({ target, nodeOpt }) {
    if (nodeOpt === "host") {
        if (target !== HOST_TARGET) {
            throw new Error(`[selfextract] --node=host requires --target=${HOST_TARGET} (got ${target})`);
        }
        console.log(`[selfextract] node: host ${process.execPath} (${process.version})`);
        return process.execPath;
    }
    if (nodeOpt !== undefined) {
        if (!existsSync(nodeOpt)) throw new Error(`[selfextract] --node path does not exist: ${nodeOpt}`);
        console.log(`[selfextract] node: ${nodeOpt}`);
        return nodeOpt;
    }
    return downloadNode({ target });
}

/**
 * Качает официальный тарбол с nodejs.org, сверяет sha256 с SHASUMS256.txt и
 * достаёт из него `bin/node`. Кэш — dist/.cache/node/.
 * @param {{ target: string }} params
 * @returns {Promise<string>}
 */
async function downloadNode({ target }) {
    const [platform, arch] = target.split("-");
    const name = `node-v${NODE_VERSION}-${platform}-${arch}`;
    const tarball = `${name}.tar.gz`;
    const baseUrl = `https://nodejs.org/dist/v${NODE_VERSION}`;

    const cacheDir = join(root, "dist", ".cache", "node");
    mkdirSync(cacheDir, { recursive: true });
    const nodePath = join(cacheDir, `node-${NODE_VERSION}-${target}`);
    if (existsSync(nodePath)) {
        console.log(`[selfextract] node: cached ${nodePath}`);
        return nodePath;
    }

    console.log(`[selfextract] node: downloading ${baseUrl}/${tarball}`);
    const [shasums, archive] = await Promise.all([fetchText(`${baseUrl}/SHASUMS256.txt`), fetchBuffer(`${baseUrl}/${tarball}`)]);

    // Целостность: качаем по https, но сверяем явно — иначе битая/подменённая
    // загрузка уедет в релизный бинарь молча.
    const expected = findShasum(shasums, tarball);
    const actual = sha256(archive);
    if (actual !== expected) {
        throw new Error(`[selfextract] sha256 mismatch for ${tarball}:\n  expected ${expected}\n  actual   ${actual}`);
    }
    console.log(`[selfextract] node: sha256 OK (${actual.slice(0, 12)}…)`);

    const tmpDir = join(cacheDir, `.tmp-${target}`);
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    const archivePath = join(tmpDir, tarball);
    writeFileSync(archivePath, archive);
    // Из всего тарбола нужен ровно bin/node.
    execFileSync("tar", ["-xzf", archivePath, "-C", tmpDir, `${name}/bin/node`], { stdio: "inherit" });
    cpSync(join(tmpDir, name, "bin", "node"), nodePath);
    chmodSync(nodePath, 0o755);
    rmSync(tmpDir, { recursive: true, force: true });
    return nodePath;
}

/**
 * Стейджит node + main.js + vexx.bundle и возвращает payload.tar.gz байтами.
 * @param {{ target: string, nodeBinary: string, mainJsPath: string, bundlePath: string }} params
 * @returns {Buffer}
 */
function buildPayload({ target, nodeBinary, mainJsPath, bundlePath }) {
    const stageDir = join(root, "dist", ".selfextract", target);
    rmSync(stageDir, { recursive: true, force: true });
    mkdirSync(stageDir, { recursive: true });

    cpSync(nodeBinary, join(stageDir, "node"));
    chmodSync(join(stageDir, "node"), 0o755);
    cpSync(mainJsPath, join(stageDir, "main.js"));
    cpSync(bundlePath, join(stageDir, "vexx.bundle"));

    // node-pty стейджим как node_modules/node-pty рядом с main.js: self-extract —
    // НЕ SEA, поэтому loadNodePty.ts идёт dev-путём createRequire(import.meta.url)
    // → require("node-pty"), а его разрешение стартует рядом с main.js. Кладём ту
    // же отфильтрованную раскладку, что и в node-pty.bundle (package.json + lib/**
    // рантайм-JS + build/Release/*), нативный .node помечаем исполняемым.
    // Scope linux-x64 (см. pack-node-pty.mjs).
    const { inputs: ptyInputs } = buildNodePtyBundle({ repoRoot: root });
    for (const { virtualPath, data } of ptyInputs) {
        const dest = join(stageDir, "node_modules", virtualPath);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, data);
        if (virtualPath.endsWith(".node") || virtualPath.endsWith("spawn-helper")) chmodSync(dest, 0o755);
    }

    // ripgrep: self-extract — НЕ SEA, поэтому loadRipgrep.ts идёт dev-путём
    // require("@vscode/ripgrep").rgPath, а тот резолвит бинарь из optional-dependency
    // @vscode/ripgrep-<platform>-<arch>. Кладём оба пакета в node_modules payload'а;
    // бинарь rg помечаем исполняемым. Scope host-платформы (см. pack-node-pty.mjs).
    stageRipgrep(stageDir);

    const payloadPath = join(stageDir, "..", `payload-${target}.tar.gz`);
    execFileSync("tar", ["-czf", payloadPath, "-C", stageDir, "."], {
        stdio: "inherit",
        // Без этого bsdtar на macOS насыпает в архив AppleDouble-файлы `._*`.
        env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    return readFileSync(payloadPath);
}

/**
 * Копирует пакеты @vscode/ripgrep (резолвер) и @vscode/ripgrep-<platform>-<arch>
 * (реальный бинарь) в `node_modules` payload'а, чтобы рантайм-require их нашёл.
 * @param {string} stageDir
 */
function stageRipgrep(stageDir) {
    const requireFromRoot = createRequire(join(root, "package.json"));
    const binaryName = process.platform === "win32" ? "rg.exe" : "rg";
    const platformName = `ripgrep-${process.platform}-${process.arch}`;

    // Резолвим сам бинарь (его subpath ЭКСПОРТИРОВАН) и выводим корни пакетов из
    // пути — `exports` в @vscode/ripgrep запрещает резолвить "./package.json".
    const rgBinaryPath = requireFromRoot.resolve(`@vscode/${platformName}/bin/${binaryName}`);
    const platformDir = dirname(dirname(rgBinaryPath)); // node_modules/@vscode/ripgrep-<platform>-<arch>
    const resolverDir = join(dirname(platformDir), "ripgrep"); // node_modules/@vscode/ripgrep

    const nodeModules = join(stageDir, "node_modules");
    cpSync(resolverDir, join(nodeModules, "@vscode", "ripgrep"), { recursive: true });
    cpSync(platformDir, join(nodeModules, "@vscode", platformName), { recursive: true });
    chmodSync(join(nodeModules, "@vscode", platformName, "bin", binaryName), 0o755);
}

/** @param {string} url */
async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`[selfextract] GET ${url} → ${response.status}`);
    return response.text();
}

/** @param {string} url */
async function fetchBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`[selfextract] GET ${url} → ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

/**
 * @param {string} shasums Содержимое SHASUMS256.txt (строки «<sha>  <файл>»).
 * @param {string} fileName
 */
function findShasum(shasums, fileName) {
    for (const line of shasums.split("\n")) {
        const [sha, name] = line.trim().split(/\s+/);
        if (name === fileName) return sha;
    }
    throw new Error(`[selfextract] ${fileName} not found in SHASUMS256.txt`);
}

/** @param {Buffer | Uint8Array} data */
function sha256(data) {
    return createHash("sha256").update(data).digest("hex");
}

// Точка входа только при прямом запуске — иначе модуль нельзя импортировать в тесты,
// не запустив сборку. Та же конвенция, что в pack-assets.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
