import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { IFileMatch, ITextSearchQuery } from "../common/textSearch.ts";

import { TextSearchService } from "./textSearchService.ts";

// Поддельный `rg` — shell-скрипт, который печатает заранее заготовленный вывод:
// так граничные случаи (ровно лимит, отмена посреди чанка, код выхода 2)
// воспроизводятся детерминированно, без зависимости от содержимого диска.

const QUERY: ITextSearchQuery = {
    pattern: "foo",
    isRegExp: false,
    isCaseSensitive: false,
    isWholeWord: false,
    includes: [],
    excludes: [],
    useIgnoreFiles: { local: true, parent: false, global: false },
};

function matchLine(file: string): string {
    return JSON.stringify({
        type: "match",
        data: {
            path: { text: file },
            lines: { text: "foo\n" },
            line_number: 1,
            absolute_offset: 0,
            submatches: [{ match: { text: "foo" }, start: 0, end: 3 }],
        },
    });
}

describe.skipIf(process.platform === "win32")("TextSearchService — против поддельного rg", () => {
    let dir: string;
    let service: TextSearchService | null = null;

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "diode-fake-rg-"));
    });
    afterEach(() => {
        service?.dispose();
        service = null;
        rmSync(dir, { recursive: true, force: true });
    });

    /** `rg`, который выводит `stdoutLines` одним куском, `stderr` и выходит с `code`. */
    function fakeRg(options: { stdoutLines?: string[]; stderr?: string; code?: number; hang?: boolean }): string {
        const out = path.join(dir, "stdout.txt");
        writeFileSync(out, (options.stdoutLines ?? []).map((line) => `${line}\n`).join(""));
        const err = path.join(dir, "stderr.txt");
        writeFileSync(err, options.stderr ?? "");
        const script = path.join(dir, "rg");
        writeFileSync(
            script,
            `#!/bin/sh\ncat '${out}'\ncat '${err}' >&2\n${options.hang === true ? "exec sleep 30\n" : ""}exit ${String(options.code ?? 0)}\n`,
        );
        chmodSync(script, 0o755);
        return script;
    }

    async function run(rg: string, onResult: (match: IFileMatch) => void = () => undefined) {
        service = new TextSearchService(rg);
        return service.search(QUERY, dir, onResult).complete;
    }

    it("ровно лимит совпадений — limitHit, и не больше лимита", async () => {
        const lines = Array.from({ length: 10_001 }, (_, i) => matchLine(path.join(dir, `f${String(i)}.ts`)));

        const atLimit = await run(fakeRg({ stdoutLines: lines.slice(0, 10_000) }));
        expect(atLimit.limitHit).toBe(true);
        expect(atLimit.matchCount).toBe(10_000);

        // Лишняя строка в том же чанке — уже после отмены: в счёт не идёт.
        const overLimit = await run(fakeRg({ stdoutLines: lines }));
        expect(overLimit.matchCount).toBe(10_000);
        expect(overLimit.fileCount).toBe(10_000);
    });

    it("отмена из колбэка: строки того же чанка после неё не доставляются", async () => {
        const results: IFileMatch[] = [];
        service = new TextSearchService(
            fakeRg({ stdoutLines: [matchLine(path.join(dir, "a.ts")), matchLine(path.join(dir, "b.ts"))] }),
        );
        const handle = service.search(QUERY, dir, (match) => {
            results.push(match);
            handle.cancel();
        });

        const complete = await handle.complete;

        expect(results.map((m) => path.basename(m.absolutePath))).toEqual(["a.ts"]);
        expect(complete.error).toBeUndefined();
    });

    it("код 2 — ошибка rg из stderr (обрезанная); код 1 «нет совпадений» и код 0 — без ошибки", async () => {
        expect((await run(fakeRg({ stderr: "regex parse error\n", code: 2 }))).error).toBe("regex parse error");
        expect((await run(fakeRg({ stderr: "noise\n", code: 1 }))).error).toBeUndefined();
        expect((await run(fakeRg({ stdoutLines: [matchLine(path.join(dir, "a.ts"))] }))).error).toBeUndefined();
    });

    it("отменённый поиск с кодом 2 ошибкой не считается", async () => {
        service = new TextSearchService(fakeRg({ stderr: "killed\n", code: 2 }));
        const handle = service.search(QUERY, dir, () => undefined);
        handle.cancel();

        expect((await handle.complete).error).toBeUndefined();
    });

    it("dispose снимает висящий rg: поиск завершается, а не ждёт его вечно", async () => {
        service = new TextSearchService(fakeRg({ hang: true }));
        const handle = service.search(QUERY, dir, () => undefined);

        service.dispose();
        service = null;

        await expect(handle.complete).resolves.toMatchObject({ matchCount: 0 });
    });
});
