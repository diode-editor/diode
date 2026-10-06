// Запуск: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { acquireLock, buildVersion, cacheRoot, computeBuildKey, E2E_VERSION, evict, readManifest, removeTree } from "./e2e-artifacts.mjs";

let dir;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "e2e-artifacts-"));
});
afterEach(() => {
    removeTree(dir);
});

function gitRepo() {
    const repo = join(dir, "repo");
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(join(repo, "e2e"), { recursive: true });
    writeFileSync(join(repo, "src", "main.ts"), "export const a = 1;\n");
    writeFileSync(join(repo, "e2e", "x.test.ts"), "test\n");
    const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    return repo;
}

test("computeBuildKey: стабилен и меняется ровно от входов сборки", () => {
    const repo = gitRepo();
    const base = computeBuildKey(repo, {});
    assert.match(base, /^[0-9a-f]{16}$/);
    assert.equal(computeBuildKey(repo, {}), base, "тот же вход — тот же ключ");

    // Тесты и всё вне входов сборки бинарь не меняют.
    writeFileSync(join(repo, "e2e", "x.test.ts"), "changed\n");
    writeFileSync(join(repo, "src", "main.test.ts"), "new test\n");
    writeFileSync(join(repo, "README.md"), "docs\n");
    assert.equal(computeBuildKey(repo, {}), base);

    // Незакоммиченная правка исходника — новый ключ; откат — старый.
    writeFileSync(join(repo, "src", "main.ts"), "export const a = 2;\n");
    const edited = computeBuildKey(repo, {});
    assert.notEqual(edited, base);
    writeFileSync(join(repo, "src", "main.ts"), "export const a = 1;\n");
    assert.equal(computeBuildKey(repo, {}), base);

    // Новый неотслеживаемый исходник — тоже вход.
    writeFileSync(join(repo, "src", "extra.ts"), "x\n");
    const withUntracked = computeBuildKey(repo, {});
    assert.notEqual(withUntracked, base);
    writeFileSync(join(repo, "src", "extra.ts"), "y\n");
    assert.notEqual(computeBuildKey(repo, {}), withUntracked, "содержимое неотслеживаемого файла — в ключе");

    // Зашиваемая версия — часть ключа.
    assert.notEqual(computeBuildKey(repo, { DIODE_VERSION: "1.2.3" }), computeBuildKey(repo, {}));
});

test("computeBuildKey: не git — null (кэшировать нечем)", () => {
    assert.equal(computeBuildKey(dir, {}), null);
});

test("buildVersion / cacheRoot: пин e2e-версии и корень кэша из окружения", () => {
    assert.equal(buildVersion({}), E2E_VERSION);
    assert.equal(buildVersion({ DIODE_VERSION: " v9 " }), "v9");
    assert.equal(cacheRoot({ DIODE_E2E_CACHE_DIR: "/x/y" }), "/x/y");
    assert.equal(cacheRoot({ XDG_CACHE_HOME: "/c" }), join("/c", "diode-e2e"));
});

test("acquireLock: второй ждёт, замок мёртвого владельца снимается", () => {
    const lock = join(dir, "k.lock");
    const release = acquireLock(lock);
    assert.equal(readFileSync(join(lock, "owner"), "utf-8"), String(process.pid));
    // Свой же замок живого владельца: ждать бессмысленно — короткий таймаут.
    assert.throws(() => acquireLock(lock, { waitMs: 0 }), /не дождался замка/);
    release();
    assert.equal(existsSync(lock), false);

    // Владелец мёртв — замок снят без ожидания.
    mkdirSync(lock);
    writeFileSync(join(lock, "owner"), "999999");
    const logs = [];
    const again = acquireLock(lock, { waitMs: 0, isProcessAlive: () => false, log: (m) => logs.push(m) });
    assert.match(logs[0], /мёртвого процесса 999999/);
    again();
});

test("acquireLock: соседний процесс держит замок — дожидаемся его", async () => {
    const lock = join(dir, "k.lock");
    // Сосед берёт замок и отпускает через ~1,5 с.
    const holder = spawn(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `import { acquireLock } from ${JSON.stringify(new URL("./e2e-artifacts.mjs", import.meta.url).href)};
             const release = acquireLock(${JSON.stringify(lock)}); console.log("held");
             setTimeout(() => { release(); }, 1500);`,
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise((resolve) => holder.stdout.once("data", resolve));
    const logs = [];
    const started = Date.now();
    const release = acquireLock(lock, { waitMs: 10_000, log: (m) => logs.push(m) });
    assert.ok(Date.now() - started >= 500, "ждали соседа");
    assert.match(logs[0], new RegExp(`собирает процесс ${String(holder.pid)}`));
    release();
    await new Promise((resolve) => holder.once("exit", resolve));
});

/** Готовая запись кэша: каталог с манифестом, «использованная» `ageSec` назад. */
function entry(root, key, ageSec, files = { binary: "diode" }) {
    const path = join(root, key);
    mkdirSync(path, { recursive: true });
    for (const rel of Object.values(files)) writeFileSync(join(path, rel), "bin");
    writeFileSync(join(path, "manifest.json"), JSON.stringify({ files }));
    const t = new Date(Date.now() - ageSec * 1000);
    utimesSync(path, t, t);
    return path;
}

test("readManifest: нет файла из манифеста — запись битая", () => {
    const ok = entry(dir, "a".repeat(16), 0);
    assert.deepEqual(readManifest(ok), { files: { binary: "diode" } });
    const broken = entry(dir, "b".repeat(16), 0, { binary: "diode", selfExtract: "gone" });
    removeTree(join(broken, "gone"));
    assert.equal(readManifest(broken), null);
    assert.equal(readManifest(join(dir, "нет")), null);
});

test("evict: держит K свежих и всё, что используется живым прогоном", () => {
    const keys = ["1", "2", "3", "4", "5"].map((c) => c.repeat(16));
    keys.forEach((k, i) => entry(dir, k, i * 100)); // keys[0] — самый свежий
    mkdirSync(join(dir, ".in-use"));
    writeFileSync(join(dir, ".in-use", `${keys[4]}@111`), ""); // старейший, но в работе
    writeFileSync(join(dir, ".in-use", `${keys[3]}@222`), ""); // метка мёртвого прогона
    // недостроенные сборки: мёртвого и живого процесса
    mkdirSync(join(dir, `${keys[0]}.tmp-333`));
    mkdirSync(join(dir, `${keys[1]}.tmp-444`));
    mkdirSync(join(dir, "чужое"));

    const removed = evict(dir, { keep: 2, isProcessAlive: (pid) => pid === 111 || pid === 444 });

    assert.deepEqual(removed.sort(), [join(dir, keys[2]), join(dir, keys[3]), join(dir, `${keys[0]}.tmp-333`)].sort());
    assert.ok(existsSync(join(dir, keys[4])), "используемую не трогаем");
    assert.ok(existsSync(join(dir, `${keys[1]}.tmp-444`)), "живую сборку не трогаем");
    assert.ok(existsSync(join(dir, "чужое")));
    assert.equal(existsSync(join(dir, ".in-use", `${keys[3]}@222`)), false, "метка мёртвого убрана");
    assert.deepEqual(evict(join(dir, "нет-такого")), []);
});

test("removeTree: сносит дерево только для чтения", { skip: process.platform === "win32" }, () => {
    const path = entry(dir, "c".repeat(16), 0);
    execFileSync("chmod", ["-R", "a-w", path]);
    removeTree(path);
    assert.equal(existsSync(path), false);
});
