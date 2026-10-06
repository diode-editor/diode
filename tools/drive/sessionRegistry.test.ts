import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type SessionRecord, SessionRegistry, validateSessionName } from "./sessionRegistry.ts";

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function registry(): { reg: SessionRegistry; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), "drive-registry-"));
    dirs.push(dir);
    return { reg: new SessionRegistry(join(dir, "sessions")), dir };
}

function record(name: string): SessionRecord {
    return {
        name,
        pid: 1,
        windowPid: 1,
        port: 2,
        root: `/tmp/r-${name}`,
        workspaceDir: "/w",
        userDataDir: "/u",
        mode: "source",
        entry: "main.ts",
        cols: 80,
        rows: 24,
        startedAt: "now",
        stdoutFile: "o",
        stderrFile: "e",
        keep: false,
        marker: `${name}:/tmp/r-${name}`,
    };
}

describe("SessionRegistry", () => {
    it("пустой (каталога ещё нет) — пустой список, чтение — undefined", () => {
        const { reg } = registry();
        expect(reg.list()).toEqual([]);
        expect(reg.read("default")).toBeUndefined();
    });

    it("запись, чтение, список по имени, удаление", () => {
        const { reg } = registry();
        reg.write(record("b"));
        reg.write(record("a"));
        expect(reg.read("a")).toEqual(record("a"));
        expect(reg.list().map((r) => r.name)).toEqual(["a", "b"]);
        reg.remove("a");
        reg.remove("never-existed");
        expect(reg.list().map((r) => r.name)).toEqual(["b"]);
    });

    it("битые и посторонние файлы список пропускает", () => {
        const { reg, dir } = registry();
        reg.write(record("ok"));
        writeFileSync(join(dir, "sessions", "broken.json"), "{");
        writeFileSync(join(dir, "sessions", "notes.txt"), "x");
        expect(reg.list().map((r) => r.name)).toEqual(["ok"]);
    });

    it("имя сессии — без путей и пробелов", () => {
        expect(validateSessionName("my-run_2.x")).toBe("my-run_2.x");
        expect(() => validateSessionName("../evil")).toThrow("недопустимое имя сессии");
        expect(() => validateSessionName("")).toThrow("недопустимое имя");
        expect(() => validateSessionName("a b")).toThrow("недопустимое имя");
        const { reg } = registry();
        expect(() => reg.read("../x")).toThrow("недопустимое имя");
    });
});
