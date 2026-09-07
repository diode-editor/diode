import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ICoreReference } from "../../../../editor/common/languages/iReferenceSource.ts";

import { buildReferenceGroups, type IReferenceTextSource } from "./referencePreview.ts";

const ROOT = "/work/project";

function uriOf(relPath: string): string {
    return Uri.file(`${ROOT}/${relPath}`).toString();
}

function ref(relPath: string, range: ReturnType<typeof createRange>): ICoreReference {
    return { uri: uriOf(relPath), range };
}

/** Источник текста: `open` — «открытые модели», `disk` — файлы на диске. */
function source(
    disk: Record<string, string>,
    open: Record<string, string> = {},
): IReferenceTextSource & { reads: string[] } {
    const reads: string[] = [];
    return {
        reads,
        openText: (uri) => open[uri.fsPath] ?? null,
        readText: (uri) => {
            reads.push(uri.fsPath);
            const text = disk[uri.fsPath];
            if (text === undefined) return Promise.reject(new Error(`ENOENT ${uri.fsPath}`));
            return Promise.resolve(text);
        },
    };
}

describe("buildReferenceGroups", () => {
    it("группирует по файлам, режет строку вокруг ссылки и даёт путь от корня", async () => {
        const src = source({
            [`${ROOT}/src/a.ts`]: 'const greet = 1;\nexport { greet };\n',
            [`${ROOT}/src/b.ts`]: 'import { greet } from "./a";\n',
        });

        const groups = await buildReferenceGroups(
            [
                ref("src/a.ts", createRange(0, 6, 0, 11)),
                ref("src/a.ts", createRange(1, 9, 1, 14)),
                ref("src/b.ts", createRange(0, 9, 0, 14)),
            ],
            src,
            ROOT,
        );

        expect(groups).toEqual([
            {
                absolutePath: `${ROOT}/src/a.ts`,
                relPath: "src/a.ts",
                matches: [
                    {
                        lineNumber: 1,
                        startColumn: 6,
                        endColumn: 11,
                        preview: { before: "const ", inside: "greet", after: " = 1;" },
                    },
                    {
                        lineNumber: 2,
                        startColumn: 9,
                        endColumn: 14,
                        preview: { before: "export { ", inside: "greet", after: " };" },
                    },
                ],
            },
            {
                absolutePath: `${ROOT}/src/b.ts`,
                relPath: "src/b.ts",
                matches: [
                    {
                        lineNumber: 1,
                        startColumn: 9,
                        endColumn: 14,
                        preview: { before: "import { ", inside: "greet", after: ' } from "./a";' },
                    },
                ],
            },
        ]);
    });

    it("файл читается один раз на запрос, даже если ссылок в нём много", async () => {
        const src = source({ [`${ROOT}/a.ts`]: "aaa\nbbb\nccc\n" });

        await buildReferenceGroups(
            [ref("a.ts", createRange(0, 0, 0, 3)), ref("a.ts", createRange(1, 0, 1, 3)), ref("a.ts", createRange(2, 0, 2, 3))],
            src,
            ROOT,
        );

        expect(src.reads).toEqual([`${ROOT}/a.ts`]);
    });

    it("открытая модель важнее диска: видны несохранённые правки", async () => {
        const src = source(
            { [`${ROOT}/a.ts`]: "на диске старое\n" },
            { [`${ROOT}/a.ts`]: "в буфере новое\n" },
        );

        const groups = await buildReferenceGroups([ref("a.ts", createRange(0, 0, 0, 2))], src, ROOT);

        expect(groups[0].matches[0].preview).toEqual({ before: "", inside: "в ", after: "буфере новое" });
        // К диску даже не ходили.
        expect(src.reads).toEqual([]);
    });

    it("недоступный файл и строка за пределами текста отбрасываются без пустых групп", async () => {
        const src = source({ [`${ROOT}/a.ts`]: "одна строка\n" });

        const groups = await buildReferenceGroups(
            [
                // Файла нет на диске вовсе.
                ref("gone.ts", createRange(0, 0, 0, 1)),
                // Файл есть, но такой строки в нём нет (поменялся, пока сервер думал).
                ref("a.ts", createRange(99, 0, 99, 1)),
                ref("a.ts", createRange(0, 0, 0, 4)),
            ],
            src,
            ROOT,
        );

        expect(groups).toHaveLength(1);
        expect(groups[0].relPath).toBe("a.ts");
        expect(groups[0].matches).toHaveLength(1);
        // Неудачное чтение тоже кэшируется — второй ссылки в тот же файл не было,
        // но повторных попыток чтения быть не должно.
        expect(src.reads).toEqual([`${ROOT}/gone.ts`, `${ROOT}/a.ts`]);
    });

    it("колонки за концом строки прижимаются к её длине", async () => {
        const src = source({ [`${ROOT}/a.ts`]: "abc\n" });

        const groups = await buildReferenceGroups(
            [ref("a.ts", createRange(0, 1, 0, 99)), ref("a.ts", createRange(0, 99, 0, 120))],
            src,
            ROOT,
        );

        expect(groups[0].matches).toEqual([
            { lineNumber: 1, startColumn: 1, endColumn: 3, preview: { before: "a", inside: "bc", after: "" } },
            { lineNumber: 1, startColumn: 3, endColumn: 3, preview: { before: "abc", inside: "", after: "" } },
        ]);
    });

    it("многострочный диапазон подсвечивается до конца первой строки", async () => {
        const src = source({ [`${ROOT}/a.ts`]: "first line\nsecond line\n" });

        const groups = await buildReferenceGroups([ref("a.ts", createRange(0, 6, 1, 3))], src, ROOT);

        expect(groups[0].matches[0]).toEqual({
            lineNumber: 1,
            startColumn: 6,
            endColumn: 10,
            preview: { before: "first ", inside: "line", after: "" },
        });
    });

    it("CRLF не оставляет \\r в конце превью", async () => {
        const src = source({ [`${ROOT}/a.ts`]: "const a = 1;\r\nconst b = 2;\r\n" });

        const groups = await buildReferenceGroups([ref("a.ts", createRange(0, 6, 0, 7))], src, ROOT);

        expect(groups[0].matches[0].preview).toEqual({ before: "const ", inside: "a", after: " = 1;" });
    });

    it("длинный хвост строки каппится и не разрывает суррогатную пару", async () => {
        const emojiAt255 = `${"x".repeat(255)}🙂${"y".repeat(50)}`;
        const src = source({
            [`${ROOT}/min.js`]: `ref${emojiAt255}\n`,
            [`${ROOT}/plain.js`]: `ref${"z".repeat(400)}\n`,
        });

        const groups = await buildReferenceGroups(
            [ref("min.js", createRange(0, 0, 0, 3)), ref("plain.js", createRange(0, 0, 0, 3))],
            src,
            ROOT,
        );

        // Пара 🙂 начинается ровно на границе среза — отрезаем её целиком.
        const emojiTail = groups[0].matches[0].preview.after;
        expect(emojiTail).toBe("x".repeat(255));
        expect(emojiTail).not.toContain("\ud83d");

        expect(groups[1].matches[0].preview.after).toBe("z".repeat(256));
    });

    it("строка ровно в кап не режется, даже если кончается половинкой пары", async () => {
        // Граница включительная: 256 символов — ещё не режем, хотя последний
        // code unit и выглядит как начало суррогатной пары.
        const exact = `${"x".repeat(255)}\ud83d`;
        const src = source({ [`${ROOT}/a.js`]: `ref${exact}\n` });

        const groups = await buildReferenceGroups([ref("a.js", createRange(0, 0, 0, 3))], src, ROOT);

        expect(groups[0].matches[0].preview.after).toBe(exact);
    });

    it("суррогатная пара на самой границе капа отрезается целиком", async () => {
        // Крайние точки диапазона старших суррогатов: U+10000 (D800 DC00) и
        // U+10FFFF (DBFF DFFF) — обе половинки должны уйти вместе.
        const lowest = `${"x".repeat(255)}\u{10000}${"y".repeat(10)}`;
        const highest = `${"x".repeat(255)}\u{10FFFF}${"y".repeat(10)}`;
        const src = source({
            [`${ROOT}/low.js`]: `ref${lowest}\n`,
            [`${ROOT}/high.js`]: `ref${highest}\n`,
        });

        const groups = await buildReferenceGroups(
            [ref("low.js", createRange(0, 0, 0, 3)), ref("high.js", createRange(0, 0, 0, 3))],
            src,
            ROOT,
        );

        expect(groups[0].matches[0].preview.after).toBe("x".repeat(255));
        expect(groups[1].matches[0].preview.after).toBe("x".repeat(255));
    });

    it("символ выше диапазона суррогатов на границе капа не режется лишний раз", async () => {
        // U+F900 — не половинка пары: верхняя граница проверки обязана его
        // пропустить, иначе от хвоста откусывается лишний символ.
        const tail = `${"x".repeat(255)}\uf900${"y".repeat(50)}`;
        const src = source({ [`${ROOT}/a.js`]: `ref${tail}\n` });

        const groups = await buildReferenceGroups([ref("a.js", createRange(0, 0, 0, 3))], src, ROOT);

        expect(groups[0].matches[0].preview.after).toBe(`${"x".repeat(255)}\uf900`);
    });

    it("возврат каретки режется только на конце строки", async () => {
        // \r в середине строки — часть текста (так его видит и сам сервер,
        // считая колонки), сносим только хвостовой от CRLF.
        const src = source({ [`${ROOT}/a.ts`]: "aa\rbb cc\r\n" });

        const groups = await buildReferenceGroups([ref("a.ts", createRange(0, 0, 0, 2))], src, ROOT);

        expect(groups[0].matches[0].preview).toEqual({ before: "", inside: "aa", after: "\rbb cc" });
    });

    it("лишние разделители после корня и обратные слэши в пути нормализуются", async () => {
        const src = source({
            [`${ROOT}//src/a.ts`]: "const a = 1;\n",
            [`${ROOT}/dir\\odd.ts`]: "const b = 2;\n",
        });

        const groups = await buildReferenceGroups(
            [
                { uri: Uri.file(`${ROOT}//src/a.ts`).toString(), range: createRange(0, 6, 0, 7) },
                { uri: Uri.file(`${ROOT}/dir\\odd.ts`).toString(), range: createRange(0, 6, 0, 7) },
            ],
            src,
            ROOT,
        );

        expect(groups.map((g) => g.relPath)).toEqual(["src/a.ts", "dir/odd.ts"]);
    });

    it("файл вне корня воркспейса показывается абсолютным путём", async () => {
        const outside = Uri.file("/opt/lib/other.ts").toString();
        const src = source({ "/opt/lib/other.ts": "export const x = 1;\n" });

        const groups = await buildReferenceGroups(
            [{ uri: outside, range: createRange(0, 13, 0, 14) }],
            src,
            ROOT,
        );

        expect(groups[0].relPath).toBe("/opt/lib/other.ts");
        expect(groups[0].absolutePath).toBe("/opt/lib/other.ts");
    });

    it("без корня воркспейса путь остаётся абсолютным", async () => {
        const src = source({ [`${ROOT}/a.ts`]: "abc\n" });

        const groups = await buildReferenceGroups([ref("a.ts", createRange(0, 0, 0, 1))], src, "");

        expect(groups[0].relPath).toBe(`${ROOT}/a.ts`);
    });

    it("сосед с общим префиксом корня не считается лежащим внутри него", async () => {
        // «/work/project2» — не «/work/project»: путь показываем целиком, а не
        // обрезанным до «2/a.ts».
        const sibling = "/work/project2/a.ts";
        const src = source({ [sibling]: "const a = 1;\n" });

        const groups = await buildReferenceGroups(
            [{ uri: Uri.file(sibling).toString(), range: createRange(0, 6, 0, 7) }],
            src,
            ROOT,
        );

        expect(groups[0].relPath).toBe(sibling);
    });

    it("пустой список ссылок — пустой список групп", async () => {
        expect(await buildReferenceGroups([], source({}), ROOT)).toEqual([]);
    });
});
