#!/usr/bin/env node
/**
 * Неизменяемая сборка бинарей для e2e: один каталог на хеш исходников в общем кэше.
 *
 *     ~/.cache/diode-e2e/
 *       <key>/              ← готовая сборка, только чтение (a-w): diode, diode-selfextract, manifest.json, …
 *       <key>.tmp-<pid>/    ← сборка в процессе; в <key>/ попадает атомарным rename
 *       <key>.lock/owner    ← межпроцессный замок на ключ (pid владельца)
 *       .in-use/<key>@<pid> ← кто сейчас гоняет тесты на этой сборке (вытеснение её не трогает)
 *
 * Зачем. Раньше e2e собирал бинарь в рабочий `dist/` — тот же каталог, который сносит
 * `tsup clean` любой ручной `build:sea`, и в который пишут соседние сеансы того же
 * дерева. Отсюда ENOENT/ETXTBSY посреди прогона, лишние сборки (OOM на 7 ГБ) и сотни МБ
 * записи под watcher'ом редактора, открытого на репозитории. Теперь:
 *  - сборка адресуется содержимым: тот же ключ — тот же бинарь, перезаписи нет вообще;
 *  - повторный прогон, второй проход автоповтора, шард, соседний worktree на том же
 *    коммите — попадание в кэш, ноль секунд сборки;
 *  - пока сборка не готова целиком, её не видно (tmp → rename), а готовую нельзя
 *    испортить (chmod a-w), даже по ошибке.
 *
 * Ключ — sha256 от входов сборки: индекс git (`ls-files -s`) + незакоммиченный дифф +
 * неотслеживаемые файлы по путям {@link BUILD_INPUTS}, плюс node/платформа, версия,
 * которую зашивает сборка, и `node_modules/.package-lock.json` (его переписывает и
 * `npm ci`, и `npm run engine:link`). Тесты (`*.test.ts`, `e2e/`) во вход не входят:
 * правка теста не пересобирает бинарь.
 *
 * Версия. Обычная сборка зашивает `nightly-<sha HEAD>`, то есть любой коммит, даже
 * docs-only, давал бы новый бинарь. Для e2e версия пиннится в {@link E2E_VERSION}
 * (если `DIODE_VERSION` не задан явно): тесты номер версии не сверяют, а кэш
 * переживает коммиты, не трогающие входы.
 *
 * CLI (то же зовёт `e2e/globalSetup.ts`):
 *     node scripts/e2e-artifacts.mjs          # собрать/найти и напечатать каталог
 *     node scripts/e2e-artifacts.mjs --key    # только ключ
 *     node scripts/e2e-artifacts.mjs --list   # что лежит в кэше
 *
 * Переменные: `DIODE_E2E_CACHE_DIR` (корень кэша), `DIODE_E2E_CACHE_KEEP` (сколько
 * сборок хранить, по умолчанию 3).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    chmodSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Версия, которую зашивает e2e-сборка (см. шапку). Именно НЕ semver, как у ночной
 * сборки: у сборки без релизной версии проверка `engines.diode` магазина считается
 * пройденной (resolveCompatibleVersion.ts), а semver-заглушка `0.0.0-e2e` её
 * проваливала — расширения с `diode >=0.3.1` не ставились.
 */
export const E2E_VERSION = "nightly-e2e";

/**
 * Поменять, когда меняется сама раскладка каталога сборки или порядок её шагов в
 * этом файле, — старые записи кэша тогда перестают совпадать.
 */
const LAYOUT_VERSION = "1";

/**
 * Что попадает в бинарь (git pathspec). Скрипты — только те, что участвуют в сборке:
 * правка `scripts/e2e.mjs` или гейтов бинарь не меняет.
 */
export const BUILD_INPUTS = [
    "src",
    "extensions",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsup.config.ts",
    "scripts/build-*.mjs",
    "scripts/pack-*.mjs",
    "scripts/selfextract-*",
    "scripts/smoke-binary.mjs",
    "scripts/resolve-version.mjs",
    // Тесты в бинарь не попадают (pathspec без glob-магии: `*` совпадает и со `/`).
    ":(exclude)*.test.ts",
    ":(exclude)*.test.mjs",
    ":(exclude)*.test.cjs",
    ":(exclude)*.snap",
];

const DEFAULT_KEEP = 3;
const KEY_RE = /^[0-9a-f]{16}$/;
const MANIFEST = "manifest.json";
/** Сколько ждать соседа, который собирает тот же ключ (сборка на 2 vCPU ~3 мин). */
const LOCK_WAIT_MS = 20 * 60_000;

const isWindows = process.platform === "win32";
const exe = (name) => (isWindows ? `${name}.exe` : name);

/** Корень кэша. */
export function cacheRoot(env = process.env) {
    if (env.DIODE_E2E_CACHE_DIR) return resolve(env.DIODE_E2E_CACHE_DIR);
    return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "diode-e2e");
}

/** Версия, которую зашьёт сборка, — часть ключа. */
export function buildVersion(env = process.env) {
    return env.DIODE_VERSION?.trim() || E2E_VERSION;
}

/**
 * Ключ сборки — см. шапку. `null`, если дерево не git (архив исходников): тогда
 * кэшировать нечем, сборка идёт в одноразовый каталог.
 *
 * @param {string} repoRoot
 * @returns {string | null}
 */
export function computeBuildKey(repoRoot, env = process.env) {
    const git = (args) => execFileSync("git", args, { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 });
    let index;
    try {
        index = git(["ls-files", "-s", "--", ...BUILD_INPUTS]);
    } catch {
        return null;
    }
    const hash = createHash("sha256");
    hash.update(`layout ${LAYOUT_VERSION}\n`);
    hash.update(`node ${process.version} ${process.platform}-${process.arch}\n`);
    hash.update(`version ${buildVersion(env)}\n`);
    hash.update(index);
    // Рабочая копия против индекса: незакоммиченные правки тоже меняют бинарь.
    hash.update(git(["diff", "--binary", "--no-ext-diff", "--", ...BUILD_INPUTS]));
    const untracked = git(["ls-files", "--others", "--exclude-standard", "-z", "--", ...BUILD_INPUTS])
        .toString()
        .split("\0")
        .filter((p) => p.length > 0)
        .sort();
    for (const rel of untracked) {
        hash.update(`untracked ${rel}\n`);
        try {
            hash.update(readFileSync(join(repoRoot, rel)));
        } catch {
            // исчез между ls-files и чтением — имя уже в ключе
        }
    }
    const lock = join(repoRoot, "node_modules", ".package-lock.json");
    hash.update(existsSync(lock) ? readFileSync(lock) : "no node_modules lock");
    return hash.digest("hex").slice(0, 16);
}

/** Жив ли процесс (EPERM — чужой, но живой). */
export function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err?.code === "EPERM";
    }
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Замок на ключ: `mkdir` атомарен на всех ОС и ФС. Владелец пишет pid; замок мёртвого
 * владельца снимается. Возвращает функцию освобождения.
 *
 * @param {string} lockDir
 * @param {{ waitMs?: number, log?: (msg: string) => void, isProcessAlive?: (pid: number) => boolean }} [options]
 */
export function acquireLock(lockDir, options = {}) {
    const { waitMs = LOCK_WAIT_MS, log = () => {}, isProcessAlive = isAlive } = options;
    const deadline = Date.now() + waitMs;
    let announced = false;
    for (;;) {
        try {
            mkdirSync(lockDir);
            writeFileSync(join(lockDir, "owner"), String(process.pid));
            return () => rmSync(lockDir, { recursive: true, force: true });
        } catch (err) {
            if (err?.code !== "EEXIST") throw err;
        }
        const owner = readOwner(lockDir);
        if (owner === null) {
            // Замок без владельца: либо его только что создали и ещё не дописали pid,
            // либо владельца убили между mkdir и записью. Отличаем по возрасту.
            if (ageMs(lockDir) > 30_000) rmSync(lockDir, { recursive: true, force: true });
        } else if (!isProcessAlive(owner)) {
            log(`замок ${lockDir} от мёртвого процесса ${String(owner)} — снимаю`);
            rmSync(lockDir, { recursive: true, force: true });
            continue;
        } else if (!announced) {
            log(`эту же сборку собирает процесс ${String(owner)} — жду его, а не собираю второй раз`);
            announced = true;
        }
        if (Date.now() > deadline) {
            throw new Error(`[e2e-artifacts] не дождался замка ${lockDir} за ${String(waitMs / 1000)} с`);
        }
        sleepSync(1000);
    }
}

function readOwner(lockDir) {
    try {
        const pid = Number.parseInt(readFileSync(join(lockDir, "owner"), "utf-8").trim(), 10);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
        return null;
    }
}

function ageMs(path) {
    try {
        return Date.now() - statSync(path).mtimeMs;
    } catch {
        return 0;
    }
}

/** Готова ли сборка: манифест есть и все перечисленные в нём файлы на месте. */
export function readManifest(dir) {
    try {
        const manifest = JSON.parse(readFileSync(join(dir, MANIFEST), "utf-8"));
        for (const rel of Object.values(manifest.files)) {
            if (!existsSync(join(dir, rel))) return null;
        }
        return manifest;
    } catch {
        return null;
    }
}

/** Снимает запрет на запись с каталогов (файлы в read-only каталоге не удалить) и сносит дерево. */
export function removeTree(path) {
    const unlock = (p) => {
        let st;
        try {
            st = lstatSync(p);
        } catch {
            return;
        }
        if (!st.isDirectory()) return;
        try {
            chmodSync(p, 0o755);
        } catch {
            // чужое — rmSync ниже скажет сам
        }
        for (const name of readdirSync(p)) unlock(join(p, name));
    };
    unlock(path);
    rmSync(path, { recursive: true, force: true });
}

/** Запрет на запись всему дереву: файлам и каталогам (исполняемым — r-x). */
function freezeTree(path) {
    if (isWindows) return; // read-only-атрибут Windows мешает только уборке; раннеры одноразовые
    const st = lstatSync(path);
    if (st.isDirectory()) {
        for (const name of readdirSync(path)) freezeTree(join(path, name));
        chmodSync(path, 0o555);
    } else if (st.isFile()) {
        chmodSync(path, st.mode & 0o111 ? 0o555 : 0o444);
    }
}

/**
 * Сносит лишние сборки: оставляет `keep` самых свежих по последнему использованию и
 * всё, на чём сейчас кто-то гоняет тесты (`.in-use/<key>@<живой pid>`). Заодно
 * подбирает недостроенные `*.tmp-<мёртвый pid>` и замки/метки мёртвых процессов.
 *
 * @returns {string[]} снесённые пути
 */
export function evict(root, { keep = DEFAULT_KEEP, isProcessAlive = isAlive } = {}) {
    let entries;
    try {
        entries = readdirSync(root);
    } catch {
        return [];
    }
    const removed = [];
    const inUse = new Set();
    const inUseDir = join(root, ".in-use");
    for (const mark of existsSync(inUseDir) ? readdirSync(inUseDir) : []) {
        const [key, pid] = mark.split("@");
        if (isProcessAlive(Number(pid))) inUse.add(key);
        else rmSync(join(inUseDir, mark), { force: true });
    }

    const builds = [];
    for (const name of entries) {
        const path = join(root, name);
        const tmp = /^([0-9a-f]{16})\.tmp-(\d+)$/.exec(name);
        if (tmp !== null) {
            if (!isProcessAlive(Number(tmp[2]))) {
                removeTree(path);
                removed.push(path);
            }
            continue;
        }
        if (KEY_RE.test(name)) builds.push({ name, path, used: statSync(path).mtimeMs });
    }
    builds.sort((a, b) => b.used - a.used);
    for (const build of builds.slice(keep)) {
        if (inUse.has(build.name)) continue;
        removeTree(build.path);
        removed.push(build.path);
    }
    return removed;
}

/**
 * Собирает всё, что нужно e2e, в `outDir`: SEA-бинарь и (не на Windows) self-extract
 * из тех же артефактов. Пишет манифест.
 */
function buildInto(outDir, { repoRoot, version, log }) {
    const env = { ...process.env, DIODE_VERSION: version, CI: "1" };
    const node = (args) => {
        log(`> node ${args.join(" ")}`);
        // Вывод сборки — в stderr: stdout прогона остаётся за репортёрами.
        execFileSync(process.execPath, args, { cwd: repoRoot, env, stdio: ["ignore", 2, 2] });
    };
    node([join(repoRoot, "scripts", "build-sea.mjs"), `--dist-dir=${outDir}`]);
    const files = { binary: exe("diode") };
    if (!isWindows) {
        node([
            join(repoRoot, "scripts", "build-selfextract.mjs"),
            "--reuse-dist",
            "--node=host",
            `--dist-dir=${outDir}`,
            `--out=${join(outDir, "diode-selfextract")}`,
        ]);
        files.selfExtract = "diode-selfextract";
        // Стейдж payload'а (копия node + node_modules) больше не нужен — сотня МБ.
        rmSync(join(outDir, ".selfextract"), { recursive: true, force: true });
    }
    const manifest = {
        version,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        builtAt: new Date().toISOString(),
        builtFrom: repoRoot,
        files,
    };
    writeFileSync(join(outDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
}

/**
 * Найти сборку под текущие исходники или собрать её. Возвращает пути и `release()`,
 * снимающий метку «используется» (зовётся из teardown прогона).
 *
 * @param {{ repoRoot: string, root?: string, keep?: number, log?: (msg: string) => void }} params
 * @returns {{ key: string | null, dir: string, binary: string, selfExtract: string | undefined, hit: boolean, release: () => void }}
 */
export function ensureE2eArtifacts({ repoRoot, root = cacheRoot(), keep, log = (m) => console.error(`[e2e-artifacts] ${m}`) }) {
    const version = buildVersion();
    const key = computeBuildKey(repoRoot);
    mkdirSync(root, { recursive: true });

    const result = (dir, manifest, hit, release) => ({
        key,
        dir,
        binary: join(dir, manifest.files.binary),
        selfExtract: manifest.files.selfExtract === undefined ? undefined : join(dir, manifest.files.selfExtract),
        hit,
        release,
    });

    if (key === null) {
        // Не git: кэшировать нечем, одноразовая сборка (уберёт evict по мёртвому pid).
        const dir = join(root, `${"0".repeat(16)}.tmp-${String(process.pid)}`);
        removeTree(dir);
        log("дерево не git — собираю без кэша");
        const manifest = buildInto(dir, { repoRoot, version, log });
        return result(dir, manifest, false, () => removeTree(dir));
    }

    const dir = join(root, key);
    // Метка «используется» — до всякой уборки, чтобы соседняя уборка не снесла сборку
    // между нашей проверкой и стартом воркеров.
    const inUseDir = join(root, ".in-use");
    mkdirSync(inUseDir, { recursive: true });
    const mark = join(inUseDir, `${key}@${String(process.pid)}`);
    writeFileSync(mark, "");
    const release = () => rmSync(mark, { force: true });

    let manifest = readManifest(dir);
    let hit = manifest !== null;
    if (manifest === null) {
        const unlock = acquireLock(join(root, `${key}.lock`), { log });
        try {
            manifest = readManifest(dir); // пока ждали замок, сосед мог собрать
            hit = manifest !== null;
            if (manifest === null) {
                if (existsSync(dir)) removeTree(dir); // битая запись (нет файла из манифеста)
                const tmp = join(root, `${key}.tmp-${String(process.pid)}`);
                removeTree(tmp);
                log(`сборки ${key} нет в кэше (${root}) — собираю`);
                const started = Date.now();
                manifest = buildInto(tmp, { repoRoot, version, log });
                freezeTree(tmp);
                renameSync(tmp, dir);
                log(`собрано за ${String(Math.round((Date.now() - started) / 1000))} с → ${dir}`);
            }
        } finally {
            unlock();
        }
    }
    if (hit) log(`сборка ${key} из кэша: ${dir}`);
    // «Последнее использование» для вытеснения — mtime каталога (utimes разрешён
    // владельцу и на read-only каталоге).
    const now = new Date();
    try {
        utimesSync(dir, now, now);
    } catch {
        // чужой кэш — вытеснение просто сочтёт сборку старой
    }
    const removed = evict(root, { keep: keep ?? Number(process.env.DIODE_E2E_CACHE_KEEP ?? DEFAULT_KEEP) });
    if (removed.length > 0) log(`вытеснено из кэша: ${removed.length}`);
    return result(dir, manifest, hit, release);
}

function listCache(root) {
    let names = [];
    try {
        names = readdirSync(root).filter((n) => KEY_RE.test(n));
    } catch {
        // пусто
    }
    for (const name of names) {
        const manifest = readManifest(join(root, name));
        const used = new Date(statSync(join(root, name)).mtimeMs).toISOString();
        console.log(`${name}  used ${used}  ${manifest === null ? "BROKEN" : `built ${manifest.builtAt} from ${manifest.builtFrom}`}`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const repoRoot = resolve(import.meta.dirname, "..");
    const arg = process.argv[2];
    if (arg === "--key") console.log(computeBuildKey(repoRoot) ?? "(not a git tree)");
    else if (arg === "--list") listCache(cacheRoot());
    else {
        const built = ensureE2eArtifacts({ repoRoot });
        built.release();
        console.log(built.dir);
    }
}
