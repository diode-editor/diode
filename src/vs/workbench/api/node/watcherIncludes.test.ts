import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { watcherIncludesUnder } from "./watcherIncludes.ts";

/**
 * `<tmp>/ws` с обычным `src` и двумя ссылками наружу: `bazel-out` (каталог) и
 * `src/gen` (ссылка поглубже). `junction` — ссылка без прав админа на Windows.
 */
let base: string;
let ws: string;

beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-watcher-include-")));
    ws = path.join(base, "ws");
    const cache = path.join(base, "cache");
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.mkdirSync(path.join(cache, "lib"), { recursive: true });
    fs.symlinkSync(cache, path.join(ws, "bazel-out"), "junction");
    fs.symlinkSync(cache, path.join(ws, "src", "gen"), "junction");
});

afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
});

describe("watcherIncludesUnder", () => {
    it("относительный путь приклеивается к папке воркспейса", () => {
        expect(watcherIncludesUnder(ws, ["bazel-out"], [ws])).toEqual([path.join(ws, "bazel-out")]);
    });

    it("абсолютный путь принимается внутри папки воркспейса", () => {
        const link = path.join(ws, "bazel-out");
        expect(watcherIncludesUnder(ws, [link], [ws])).toEqual([link]);
    });

    it("абсолютный путь вне воркспейса отбрасывается, как у эталона", () => {
        // Ссылка лежит под базой watcher'а, но вне папки воркспейса.
        const outsideLink = path.join(base, "outside-link");
        fs.symlinkSync(path.join(base, "cache"), outsideLink, "junction");
        expect(watcherIncludesUnder(base, [outsideLink], [ws])).toEqual([]);
    });

    it("абсолютный путь достаточно найти в одной из папок воркспейса", () => {
        const other = path.join(base, "other");
        fs.mkdirSync(other);
        const link = path.join(ws, "bazel-out");
        expect(watcherIncludesUnder(ws, [link], [other, ws])).toEqual([link]);
    });

    it("предок папки воркспейса — не внутри неё", () => {
        // Папка лежит за ссылкой, а путь настройки — ровно на уровень выше папки.
        const folder = path.join(ws, "bazel-out", "lib");
        expect(watcherIncludesUnder(ws, [path.join(ws, "bazel-out")], [folder])).toEqual([]);
    });

    it("путь за ссылкой глубже первого сегмента тоже берётся", () => {
        expect(watcherIncludesUnder(ws, ["src/gen/lib"], [ws])).toEqual([path.join(ws, "src", "gen", "lib")]);
    });

    it("обычный каталог не берётся: обход базы его и так видит, второй watch задвоил бы события", () => {
        expect(watcherIncludesUnder(ws, ["src"], [ws])).toEqual([]);
    });

    it("путь вне базы watcher'а не его забота", () => {
        expect(watcherIncludesUnder(path.join(ws, "src"), ["bazel-out"], [ws])).toEqual([]);
    });

    it("путь, равный базе, не добавляется — база уже следится", () => {
        const link = path.join(ws, "bazel-out");
        expect(watcherIncludesUnder(link, ["bazel-out"], [ws])).toEqual([]);
    });

    it("внутри базы-ссылки путь меряется от неё самой", () => {
        // База — сама ссылка, её корень watcher разрешит; `lib` за ней — обычный каталог.
        expect(watcherIncludesUnder(path.join(ws, "bazel-out"), ["bazel-out/lib"], [ws])).toEqual([]);
    });

    it("один и тот же путь, записанный дважды, — один watch", () => {
        expect(watcherIncludesUnder(ws, ["bazel-out", path.join(ws, "bazel-out")], [ws])).toEqual([
            path.join(ws, "bazel-out"),
        ]);
    });

    it("битая настройка и пустые/нестроковые элементы — без include", () => {
        expect(watcherIncludesUnder(ws, "bazel-out", [ws])).toEqual([]);
        expect(watcherIncludesUnder(ws, 42, [ws])).toEqual([]);
        expect(watcherIncludesUnder(ws, undefined, [ws])).toEqual([]);
        expect(watcherIncludesUnder(ws, ["", 42, null], [ws])).toEqual([]);
    });

    it("без папок воркспейса относительному пути не к чему приклеиться", () => {
        expect(watcherIncludesUnder(ws, ["bazel-out"], [])).toEqual([]);
    });

    it("несуществующий путь — не ссылка, не добавляется", () => {
        expect(watcherIncludesUnder(ws, ["missing/deeper"], [ws])).toEqual([]);
    });

    it("каталог с ведущими точками лежит внутри, а не снаружи", () => {
        fs.symlinkSync(path.join(base, "cache"), path.join(ws, "..gen"), "junction");
        expect(watcherIncludesUnder(ws, [path.join(ws, "..gen")], [ws])).toEqual([path.join(ws, "..gen")]);
    });
});
