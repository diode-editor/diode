import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { startHeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";

// Функциональный e2e для диффа (PR #202, с PR-4 DiffEditable — живой дифф v2
// из двух настоящих редакторов): чёрным ящиком через инспектор настоящего
// бинаря. Extension host нужен (git-расширение отдаёт версию из HEAD), поэтому
// гоняем только на Linux.

const runOnLinux = process.platform === "linux" ? describe : describe.skip;

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

interface Repo {
    dir: string;
    file(rel: string): string;
}

/** Временный git-репозиторий с закоммиченными сид-файлами. */
function makeRepo(committed: Record<string, string>): Repo {
    const dir = mkdtempSync(join(tmpdir(), "diode-diff-e2e-"));
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "Test");
    git(dir, "config", "commit.gpgsign", "false");
    for (const [rel, content] of Object.entries(committed)) {
        writeFileSync(join(dir, rel), content);
    }
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
    return { dir, file: (rel) => join(dir, rel) };
}

const TRACKED = [
    ...Array.from({ length: 12 }, (_, i) => `const value${String(i)} = ${String(i)};`),
    "export function greet(name) {",
    '    return "hi " + name;',
    "}",
    "",
].join("\n");

/** Вызвать команду через палитру — ровно как пользователь. */
async function invokeCompare(session: HeadlessSession): Promise<void> {
    await session.key("Ctrl+P");
    await session.text(">Compare Active File with HEAD");
    await session.waitForText((t) => t.includes("Compare Active File with HEAD"));
    await session.key("Enter");
}

/** Состояние таб-стрипа группы редакторов. */
async function tabs(session: HeadlessSession): Promise<{ label: string; active: boolean; readOnly: boolean }[]> {
    const strip = await session.node("EditorTabStripElement");
    return (strip?.state?.tabs ?? []) as { label: string; active: boolean; readOnly: boolean }[];
}

runOnLinux("Diff viewer (functional e2e)", () => {
    const repos: Repo[] = [];
    let app: HeadlessApp | null = null;

    function repo(committed: Record<string, string>): Repo {
        const r = makeRepo(committed);
        repos.push(r);
        return r;
    }

    async function open(openArgs: string[], cwd: string, cols = 100): Promise<HeadlessSession> {
        app = await startHeadlessApp({ open: openArgs, cwd, cols, rows: 24 });
        return app.session;
    }

    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    afterAll(() => {
        for (const r of repos) rmSync(r.dir, { recursive: true, force: true });
    });

    async function teardown(): Promise<void> {
        await app?.dispose();
        app = null;
    }

    // ── C. Живой гуттер (карта 10) ──────────────────────────────────────────
    it("живой гуттер: правка tracked-файла даёт бар ┋ до сохранения", async () => {
        const r = repo({ "greeting.txt": "alpha\nbravo\ncharlie\ndelta\n" });
        const s = await open([r.dir, r.file("greeting.txt")], r.dir);
        try {
            await s.waitForText((t) => t.includes("charlie"));
            // Правим строку 2, НЕ сохраняя.
            await s.key("ArrowDown");
            await s.text("XX");
            await s.waitForText((t) => t.includes("XXbravo"));
            // Бар должен появиться от самой правки (главный баг PR).
            await s.waitForText((t) => t.includes("┋"), { timeoutMs: 15_000 });
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── A+B. Команда + вкладка против живого буфера (карта 1,2,3,4) ──────────
    it("Compare with HEAD: открывает живую вкладку ↔ HEAD с +/- по несохранённой правке", async () => {
        const r = repo({ "greeting.js": TRACKED });
        // Шире дефолта: в две колонки длинная строка с правкой обязана влезть.
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await s.waitForText((t) => t.includes("greet"));

            // Правим строку возврата, НЕ сохраняя — дифф должен считаться против буфера.
            await s.key("Ctrl+End");
            await s.key("ArrowUp");
            await s.key("ArrowUp");
            await s.key("End");
            await s.text(" // changed");
            await s.waitForText((t) => t.includes("// changed"));
            // Ждём активацию git-ext + доступность оригинала: бар в гуттере.
            await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });

            await invokeCompare(s);
            await s.waitForText((t) => t.includes("↔ HEAD"), { timeoutMs: 15_000 });

            const frame = frameToText(await s.captureFrame());
            // Дифф против буфера: правка видна плюсом.
            expect(frame).toContain("// changed");
            expect(frame).toMatch(/[+]/u);
            // Свёртка неизменённых кусков.
            expect(frame).toMatch(/unchanged line/u);

            // Вкладка активна и НЕ read-only: modified-сторона — живой буфер.
            const strip = await tabs(s);
            const diffTab = strip.find((t) => t.label.includes("↔ HEAD"));
            expect(diffTab, `tabs: ${JSON.stringify(strip)}`).toBeDefined();
            expect(diffTab?.readOnly).toBe(false);
            expect(diffTab?.active).toBe(true);

            // Фокус ушёл в сторону диффа — настоящий редактор.
            expect(await s.focusedType()).toBe("EditorElement");
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── B. Живой editable-дифф: правка в стороне доезжает до буфера (PR-4) ──
    it("печать в стороне диффа правит буфер файла, дифф пересчитывается сам", async () => {
        const r = repo({ "greeting.js": TRACKED });
        // Шире порога inline: тест ассертит side-by-side пару N-/N+.
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await s.waitForText((t) => t.includes("greet"));
            await s.key("End");
            await s.text(" // edited");
            await s.waitForText((t) => t.includes("// edited"));
            await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });
            await invokeCompare(s);
            await s.waitForText((t) => t.includes("↔ HEAD"), { timeoutMs: 15_000 });

            // Каретка в modified-стороне (0,0): печать попадает в живой буфер.
            await s.text("ZZQ");
            await s.waitForText((t) => t.includes("ZZQconst"));
            // Живой пересчёт (debounce 200) помечает строку изменённой парой.
            await s.waitForText((t) => {
                const line = t.split("\n").find((l) => l.includes("ZZQconst"));
                return line !== undefined && line.includes("1-") && line.includes("1+");
            }, { timeoutMs: 15_000 });

            // Правка видна и в обычной вкладке файла — модель общая.
            await s.key("Ctrl+P");
            await s.text("greeting.js");
            await s.key("Enter");
            await s.waitForFocus("EditorElement");
            await s.waitForText((t) => t.includes("ZZQconst"));
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── B. Каретка ведёт вьюпорт (карта 5) ──────────────────────────────────
    it("дифф листается курсором (дифф выше вьюпорта)", async () => {
        // Коммитим одну строку, а в буфер добавляем 80 уникальных — добавленные
        // строки не сворачиваются, дифф гарантированно выше 24-строчного экрана.
        const r = repo({ "long.txt": "HEADLINE\n" });
        const s = await open([r.dir, r.file("long.txt")], r.dir);
        try {
            await s.waitForText((t) => t.includes("HEADLINE"));
            await s.key("Ctrl+End");
            const block = "\n" + Array.from({ length: 80 }, (_, i) => `row${String(i).padStart(3, "0")}`).join("\n");
            await s.text(block);
            await s.waitForText((t) => t.includes("row079"));
            await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });
            await invokeCompare(s);
            await s.waitForText((t) => t.includes("↔ HEAD"), { timeoutMs: 15_000 });

            const top = frameToText(await s.captureFrame());
            expect(top).toContain("row000");
            expect(top).not.toContain("row079"); // за пределами экрана в начале
            // Каретка уезжает вниз, вьюпорт следует за ней.
            for (let i = 0; i < 20; i++) await s.key("PageDown");
            const bottom = frameToText(await s.captureFrame());
            expect(bottom).toContain("row079");
            // Ctrl+Home возвращает наверх. Именно Ctrl+Home, а не Home: с
            // появлением каретки Home стал «в начало строки», как в VS Code.
            await s.key("Ctrl+Home");
            const backTop = frameToText(await s.captureFrame());
            expect(backTop).toContain("row000");
            expect(backTop).not.toContain("row079");
            const sides = await s.nodes("EditorElement");
            expect(sides.at(-1)?.state?.selections).toEqual([
                { anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 }, collapsed: true },
            ]);
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── A. Повторный вызов после новой правки обновляет снимок (карта 9) ──────
    it("повторный Compare после новой правки показывает свежий снимок", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await s.waitForText((t) => t.includes("greet"));
            await s.key("End");
            await s.text(" // AAAA");
            await s.waitForText((t) => t.includes("// AAAA"));
            await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });
            await invokeCompare(s);
            await s.waitForText((t) => t.includes("↔ HEAD"), { timeoutMs: 15_000 });
            expect(frameToText(await s.captureFrame())).toContain("// AAAA");

            // Возвращаемся в текстовый редактор через Quick Open и добавляем вторую правку.
            await s.key("Ctrl+P");
            await s.text("greeting.js");
            await s.key("Enter");
            await s.waitForFocus("EditorElement");
            await s.key("End");
            await s.text(" // BBBB");
            await s.waitForText((t) => t.includes("// BBBB"));

            // Пользователь снова зовёт Compare, ожидая увидеть обе правки.
            await invokeCompare(s);
            await s.waitForText((t) => t.includes("↔ HEAD"), { timeoutMs: 15_000 });
            const frame = frameToText(await s.captureFrame());
            const strip = await tabs(s);
            const diffCount = strip.filter((t) => t.label.includes("↔ HEAD")).length;
            // Ровно одна дифф-вкладка (дедуп по ресурсу — это ожидаемо).
            expect(diffCount).toBe(1);
            // Вкладка отражает актуальный буфер (обе правки): команда обновляет
            // уже открытую дифф-вкладку того же ресурса свежим снимком на месте
            // (`DiffEditorPane.setInput`), а не реактивирует старую со снимком AAAA.
            expect(frame).toContain("// BBBB");
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── A. Untracked-файл → нотис (карта 6) ─────────────────────────────────
    it("untracked-файл: команда сообщает, что сравнивать не с чем", async () => {
        const r = repo({ "tracked.txt": "committed\n" });
        writeFileSync(r.file("fresh.txt"), "brand new file\n");
        const s = await open([r.dir, r.file("fresh.txt")], r.dir);
        try {
            await s.waitForText((t) => t.includes("brand new file"));
            // Дать git-расширению активироваться (иначе нотис — по не той причине).
            await s.waitForText((t) => t.includes("fresh.txt") || t.includes("EXPLORER"), { timeoutMs: 10_000 });
            await invokeCompare(s);
            await s.waitForText((t) => t.includes("No changes to compare"), { timeoutMs: 15_000 });
            // Вкладки диффа быть не должно.
            const strip = await tabs(s);
            expect(strip.some((t) => t.label.includes("↔ HEAD"))).toBe(false);
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── A. Чистый файл при АКТИВНОМ git (карта 8) ───────────────────────────
    it("чистый файл при активном git: открывается вкладка ↔ HEAD, а не нотис", async () => {
        const r = repo({ "same.txt": "one\ntwo\nthree\n" });
        const s = await open([r.dir, r.file("same.txt")], r.dir);
        try {
            await s.waitForText((t) => t.includes("three"));
            // Детерминированно форсим активацию git-расширения: грязним буфер до
            // появления бара, затем откатываем — теперь провайдер точно поднят,
            // а буфер снова равен HEAD.
            await s.key("End");
            await s.text("Z");
            await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });
            await s.key("Ctrl+Z");
            await s.waitForText((t) => !t.includes("┋") && !t.includes("┃"));

            await invokeCompare(s);
            await s.waitForText((t) => t.includes("↔ HEAD") || t.includes("No changes"), { timeoutMs: 15_000 });
            const strip = await tabs(s);
            const openedDiff = strip.some((t) => t.label.includes("↔ HEAD"));
            // Закоммиченный файл ИМЕЕТ версию в git — сообщение «has no version in git» было бы неверным.
            expect(openedDiff).toBe(true);
            // Пустой дифф говорит главное (US-11).
            expect(frameToText(await s.captureFrame())).toContain("The files are identical");
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── D. Дифф как текстовая поверхность: каретка, выделение, копирование ───

    /** Правит буфер и открывает дифф; фокус остаётся в дифф-панели. */
    async function openDiffFor(s: HeadlessSession, edit: string): Promise<void> {
        await s.waitForText((t) => t.includes("greet"));
        await s.key("Ctrl+End");
        await s.key("ArrowUp");
        await s.key("ArrowUp");
        await s.key("End");
        await s.text(edit);
        await s.waitForText((t) => t.includes(edit.trim()));
        await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });
        await invokeCompare(s);
        await s.waitForText((t) => t.includes("↔ HEAD"), { timeoutMs: 15_000 });
        await s.waitForFocus("EditorElement");
    }

    /** Состояние modified-стороны (последний EditorElement в дереве пары). */
    const selectionOf = async (s: HeadlessSession) => (await s.nodes("EditorElement")).at(-1)?.state;

    it("каретка в диффе ходит стрелками", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir);
        try {
            await openDiffFor(s, " // moved");

            expect((await selectionOf(s))?.selections).toEqual([
                { anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 }, collapsed: true },
            ]);

            await s.key("ArrowDown");
            await s.key("ArrowRight");
            await s.key("ArrowRight");

            // Координаты документные: ArrowDown с заголовка свёрнутого куска
            // перепрыгивает скрытые строки и зону-плашку.
            const state = await selectionOf(s);
            const active = (state?.selections as { active: { line: number; character: number } }[])[0].active;
            expect(active.line).toBeGreaterThan(1);
            expect(active.character).toBe(2);
            // Сторона — живой буфер: правка возможна.
            expect(state?.readOnly).toBe(false);
        } finally {
            await teardown();
        }
    }, 120_000);

    it("Shift+End выделяет строку, Ctrl+C кладёт в буфер текст без гуттера", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await openDiffFor(s, " // ZZQQ");

            // Кликом ставим каретку на добавленную строку — ту, что нарисована с
            // маркером `+` и двумя номерами слева.
            const frame = frameToText(await s.captureFrame()).split("\n");
            const row = frame.findIndex((line) => line.includes("ZZQQ"));
            expect(row).toBeGreaterThan(0);
            expect(frame[row]).toMatch(/\+/u); // именно добавленная строка, с маркером
            // Координаты берём от самой панели: слева сайдбар, и абсолютный x=20
            // попал бы в дерево файлов, уведя фокус из диффа.
            const view = await s.waitForNode("DiffPaneElement");
            await s.click(view.box.x + view.box.width - 2, row);

            await s.key("Home");
            await s.key("Shift+End");
            expect((await selectionOf(s))?.hasSelection).toBe(true);
            await s.key("Ctrl+C");

            // Вставляем в инпут Quick Open: он пуст и отдаёт своё содержимое
            // посимвольно, поэтому проверяет буфер точнее любого кадра.
            await s.key("Ctrl+P");
            await s.key("Ctrl+V");
            const input = await s.waitForNode("InputElement");

            // Ровно текст строки: ни номеров строк, ни маркера `+` — они в
            // гуттере, а не в документе. Home встал на первый непробельный, как
            // в редакторе, поэтому отступа тоже нет.
            expect(input.state?.value).toBe('return "hi " + name; // ZZQQ');
            await s.key("Escape");
        } finally {
            await teardown();
        }
    }, 120_000);

    it("протяжка мышью выделяет строки диффа", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir);
        try {
            await openDiffFor(s, " // dragme");

            const node = await s.waitForNode("DiffPaneElement");
            // Правая половина пары — modified-сторона; +1 по y — под строкой
            // заголовков колонок.
            const x = node.box.x + Math.floor(node.box.width / 2) + 8;
            const y = node.box.y + 1;
            await s.sendMouse({ action: "press", button: "left", x, y });
            await s.sendMouse({ action: "move", button: "left", x: x + 5, y: y + 2 });
            await s.sendMouse({ action: "release", button: "left", x: x + 5, y: y + 2 });
            await s.waitForIdle();

            expect((await selectionOf(s))?.hasSelection).toBe(true);
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── F. Семейство команд сравнения (US-3, US-6) ───────────────────────────
    it("Compare with Saved: вкладка «(on disk) ↔ файл» по несохранённой правке", async () => {
        const r = repo({ "notes.txt": "alpha\nbravo\ncharlie\n" });
        const s = await open([r.dir, r.file("notes.txt")], r.dir, 140);
        try {
            await s.waitForText((t) => t.includes("charlie"));
            await s.key("ArrowDown");
            await s.text("XX");
            await s.waitForText((t) => t.includes("XXbravo"));

            await s.key("Ctrl+P");
            await s.text(">Compare Active File with Saved");
            await s.waitForText((t) => t.includes("Compare Active File with Saved"));
            await s.key("Enter");
            await s.waitForText((t) => t.includes("(on disk) ↔ notes.txt"), { timeoutMs: 15_000 });

            const frame = frameToText(await s.captureFrame());
            expect(frame).toMatch(/2-\s+bravo/u);
            expect(frame).toMatch(/2\+\s+XXbravo/u);
        } finally {
            await teardown();
        }
    }, 120_000);

    it("Compare Active File With...: пикер открывает дифф двух файлов", async () => {
        const r = repo({ "left.txt": "alpha\nLEFT\n", "right.txt": "alpha\nRIGHT\n" });
        const s = await open([r.dir, r.file("left.txt")], r.dir, 140);
        try {
            await s.waitForText((t) => t.includes("LEFT"));

            await s.key("Ctrl+P");
            await s.text(">Compare Active File With...");
            await s.waitForText((t) => t.includes("Compare Active File With..."));
            await s.key("Enter");
            // Пикер второй стороны: сузить до right.txt и подтвердить.
            await s.waitForText((t) => t.includes("Select a file to compare with"), { timeoutMs: 15_000 });
            await s.text("right");
            await s.waitForText((t) => t.includes("right.txt"));
            await s.key("Enter");
            await s.waitForText((t) => t.includes("left.txt ↔ right.txt"), { timeoutMs: 15_000 });

            const frame = frameToText(await s.captureFrame());
            expect(frame).toMatch(/2-\s+LEFT/u);
            expect(frame).toMatch(/2\+\s+RIGHT/u);
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── G. Open File at Revision (DiffEditable PR-1) ─────────────────────────
    it("Open File at Revision: read-only вкладка с контентом ветки", async () => {
        const r = repo({ "story.txt": "alpha\nbravo\n" });
        git(r.dir, "branch", "old-branch");
        writeFileSync(r.file("story.txt"), "alpha\nbravo\ncharlie\n");
        git(r.dir, "add", "-A");
        git(r.dir, "commit", "-qm", "second");
        const s = await open([r.dir, r.file("story.txt")], r.dir);
        try {
            await s.waitForText((t) => t.includes("charlie"));
            // Дождаться активации git-расширения (иначе пикер пуст).
            await s.key("End");
            await s.text("Z");
            await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });
            await s.key("Ctrl+Z");

            await s.key("Ctrl+P");
            await s.text(">Open File at Revision");
            await s.waitForText((t) => t.includes("Open File at Revision"));
            await s.key("Enter");
            await s.waitForText((t) => t.includes("Pick a branch or tag"), { timeoutMs: 15_000 });
            await s.text("old-branch");
            await s.key("Enter");
            await s.waitForText((t) => t.includes("story.txt (old-branch)"), { timeoutMs: 15_000 });

            const frame = frameToText(await s.captureFrame());
            // Контент ветки: третьей строки нет.
            expect(frame).toContain("bravo");
            expect(frame).not.toContain("charlie");
            // Вкладка read-only — с замком в табе.
            const strip = await tabs(s);
            const revTab = strip.find((t) => t.label.includes("(old-branch)"));
            expect(revTab?.readOnly).toBe(true);
            // Ввод не меняет содержимое.
            await s.text("EDIT");
            expect(frameToText(await s.captureFrame())).not.toContain("EDIT");
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── H. Дифф v2: два настоящих редактора (DiffEditable PR-3/PR-4) ────────
    it("v2: вкладка из двух редакторов — выравнивание, плашки, каретка в стороне", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await s.waitForText((t) => t.includes("greet"));
            await s.key("Ctrl+End");
            await s.key("ArrowUp");
            await s.key("ArrowUp");
            await s.key("End");
            await s.text(" // v2");
            await s.waitForText((t) => t.includes("// v2"));
            await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });

            await invokeCompare(s);
            await s.waitForText((t) => t.includes("↔ HEAD"), { timeoutMs: 15_000 });

            const frame = frameToText(await s.captureFrame());
            // Пара изменённых строк на одной высоте по обе стороны разделителя.
            const pair = frame.split("\n").find((l) => l.includes('"hi "') && l.includes("// v2"));
            expect(pair).toBeDefined();
            expect(pair).toContain("│");
            // Парная плашка свёртки.
            const plaque = frame.split("\n").find((l) => l.includes("unchanged lines"));
            expect(plaque?.split("│").filter((p) => p.includes("unchanged lines"))).toHaveLength(2);

            // Каретка живёт в стороне: стрелка вниз двигает выделение.
            await s.key("ArrowDown");
            const editorNodes = await s.nodes("EditorElement");
            expect(editorNodes.length).toBeGreaterThanOrEqual(2);
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── E. Side-by-side: resize не теряет каретку (US-23; inline-фолбэк — PR-5) ──
    it("US-21: узкий терминал — авто-inline с призраком, resize обратно возвращает колонки", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await openDiffFor(s, " // wide");

            // Широко: две колонки с заголовками сторон.
            expect(frameToText(await s.captureFrame())).toContain("│");

            // Каретка уезжает вниз в правой (modified) стороне.
            await s.key("ArrowDown");
            const caretBefore = ((await selectionOf(s))?.selections as { active: { line: number } }[])[0].active
                .line;

            // Узко: панель уже порога — inline. Общий заголовок, изменённая
            // строка HEAD видна призраком (без номера), правка — с маркером.
            await s.resize(100, 24);
            await s.waitForText((t) => t.includes("HEAD ↔ greeting.js"), { timeoutMs: 15_000 });
            const inlineFrame = frameToText(await s.captureFrame()).split("\n");
            const ghost = inlineFrame.find((l) => l.includes('return "hi " + name;') && !l.includes("// wide"));
            expect(ghost).toBeDefined();
            expect(ghost).not.toMatch(/\d/u);
            expect(inlineFrame.find((l) => /\d+\+\s+.*\/\/ wide/u.test(l))).toBeDefined();

            // Обратно: side-by-side, каретка на своей строке (US-23).
            await s.resize(140, 24);
            await s.waitForText((t) => t.split("\n").some((l) => l.includes("HEAD") && l.includes("│")), {
                timeoutMs: 15_000,
            });
            const after = await selectionOf(s);
            expect((after?.selections as { active: { line: number } }[])[0].active.line).toBe(caretBefore);
        } finally {
            await teardown();
        }
    }, 120_000);

    it("US-22: «Diff: Toggle Inline View» переключает режим и запоминается", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await openDiffFor(s, " // toggle");
            expect(frameToText(await s.captureFrame())).toContain("│");

            await s.key("Ctrl+P");
            await s.text(">Diff: Toggle Inline View");
            await s.waitForText((t) => t.includes("Toggle Inline View"));
            await s.key("Enter");
            // Широкий терминал, но режим принудительно inline.
            await s.waitForText((t) => t.includes("HEAD ↔ greeting.js"), { timeoutMs: 15_000 });

            // Обратный тумблер возвращает колонки.
            await s.key("Ctrl+P");
            await s.text(">Diff: Toggle Inline View");
            await s.waitForText((t) => t.includes("Toggle Inline View"));
            await s.key("Enter");
            await s.waitForText((t) => t.split("\n").some((l) => l.includes("HEAD") && l.includes("│")), {
                timeoutMs: 15_000,
            });
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── I. Compare New Untitled Text Files (US-37, PR-4) ─────────────────────
    // ── J. PR-5: revert-чанка и живой сдвиг HEAD (US-31) ─────────────────────
    it("Diff: Revert Hunk откатывает правку под кареткой прямо из диффа", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await openDiffFor(s, " // revertme");
            await s.waitForText((t) => t.includes("// revertme"));

            // Каретка на изменённой строке: она видна, кликать не нужно —
            // ставим через поиск ганка стрелками? Нет: revert ищет ганк по
            // каретке — доводим её командами (строка возврата видна).
            const frame = frameToText(await s.captureFrame()).split("\n");
            const row = frame.findIndex((line) => line.includes("// revertme"));
            expect(row).toBeGreaterThan(0);
            const view = await s.waitForNode("DiffPaneElement");
            await s.click(view.box.x + view.box.width - 2, row);

            await s.key("Ctrl+P");
            await s.text(">Diff: Revert Hunk");
            await s.waitForText((t) => t.includes("Revert Hunk"));
            await s.key("Enter");

            // Правка откатилась; живой пересчёт съел разметку ганка.
            await s.waitForText((t) => !t.includes("// revertme"), { timeoutMs: 15_000 });
            // И в буфере файла её тоже нет (модель общая) — Ctrl+Z вернул бы.
            await s.key("Ctrl+P");
            await s.text("greeting.js");
            await s.key("Enter");
            await s.waitForFocus("EditorElement");
            expect(frameToText(await s.captureFrame())).not.toContain("// revertme");
        } finally {
            await teardown();
        }
    }, 120_000);

    it("US-31: git commit в обход приложения освежает HEAD-сторону открытого диффа", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await openDiffFor(s, " // live-head");
            await s.waitForText((t) => t.includes("// live-head"));

            // «Коммит из терминала»: рабочее дерево уже содержит правку? Нет —
            // правка не сохранена. Меняем HEAD иначе: коммитим НОВОЕ содержимое
            // файла напрямую в git, как это сделал бы rebase/pull.
            const committed = TRACKED.replace('return "hi " + name;', 'return "hi " + name; // live-head');
            writeFileSync(r.file("shadow.tmp"), committed);
            git(r.dir, "update-index", "--add", "--cacheinfo", "100644",
                execFileSync("git", ["hash-object", "-w", r.file("shadow.tmp")], { cwd: r.dir })
                    .toString()
                    .trim(),
                "greeting.js");
            git(r.dir, "commit", "-qm", "shadow-commit");

            // Дифф сам освежает HEAD-сторону: ганк исчез, стороны сравнялись
            // (весь файл — unchanged-кусок; правка скрыта его свёрткой).
            await s.waitForText((t) => !t.includes("// live-head") && t.includes("unchanged lines"), {
                timeoutMs: 30_000,
            });
        } finally {
            await teardown();
        }
    }, 120_000);

    it("Compare New Untitled: обе стороны редактируются, дифф живой, закрытие спрашивает", async () => {
        const r = repo({ "seed.txt": "seed\n" });
        const s = await open([r.dir], r.dir, 140);
        try {
            // Под нагрузкой полного прогона старт и палитра бывают медленными.
            await s.waitForText((t) => t.includes("EXPLORER"), { timeoutMs: 60_000 });
            await s.key("Ctrl+P");
            await s.text(">Compare New Untitled Text Files");
            await s.waitForText((t) => t.includes("Compare New Untitled Text Files"), { timeoutMs: 15_000 });
            await s.key("Enter");
            await s.waitForText((t) => t.includes("Untitled-1 ↔ Untitled-2"), { timeoutMs: 15_000 });

            // Печать попадает в правую сторону (фокус в modified).
            await s.text("hello");
            await s.waitForText((t) => t.includes("hello"));
            // Живой пересчёт помечает строку добавленной: маркер + у строки 1.
            await s.waitForText((t) => {
                const line = t.split("\n").find((l) => l.includes("hello"));
                return line !== undefined && line.includes("1+");
            }, { timeoutMs: 15_000 });

            // Закрытие вкладки с несохранённой untitled-стороной — confirm-диалог.
            await s.key("Ctrl+W");
            await s.waitForText((t) => t.includes("Untitled-2") && t.includes("ave"), { timeoutMs: 15_000 });
            await s.key("Escape");
            await s.waitForText((t) => t.includes("Untitled-1 ↔ Untitled-2"), { timeoutMs: 15_000 });
        } finally {
            await teardown();
        }
    }, 120_000);
});
