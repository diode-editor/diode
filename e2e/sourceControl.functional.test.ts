import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { OPEN_FILE_BUTTON_WIDTH } from "../src/vs/workbench/contrib/scm/browser/scmChangeRows.ts";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { frameToText } from "./helpers/frame.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Функциональные e2e Source Control (#207, миграция на ListViewElement): чёрным
// ящиком через инспектор настоящего бинаря. Проверяем заявленное поведение и
// крайние случаи: переключение Explorer↔SCM, список изменений, прямой дифф по
// двойному клику (одной вкладкой), инлайн-кнопку Open File, режимы tree/flat,
// контекстное меню, untracked/deleted, чистое репо, не-git папку.

// Переключатели вьюлетов и режимов — user-кейбиндами (детерминированно, без
// палитры). Буквы НЕ мнемонические (F/E/S/V/G/H — меню-бар), как в scenario.
const SWITCH_KEYS = [
    { key: "alt+c", command: "workbench.view.scm" },
    { key: "alt+x", command: "workbench.view.explorer" },
    { key: "alt+t", command: "scm.action.viewAsTree" },
    { key: "alt+l", command: "scm.action.viewAsList" },
];

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

interface RepoOptions {
    /** Файлы, которые коммитим в начальный коммит. */
    committed?: Record<string, string>;
    /** Правки поверх закоммиченного (modified). */
    modify?: Record<string, string>;
    /** Новые файлы на диске (untracked). */
    untracked?: Record<string, string>;
    /** Не делать никаких рабочих изменений (чистое дерево). */
    clean?: boolean;
    /** Не инициализировать git вовсе (обычная папка). */
    noGit?: boolean;
}

function writeAll(repoDir: string, files: Record<string, string>): void {
    for (const [rel, content] of Object.entries(files)) {
        const file = join(repoDir, rel);
        execFileSync("mkdir", ["-p", join(file, "..")]);
        writeFileSync(file, content);
    }
}

function makeRepo(opts: RepoOptions): string {
    const repoDir = mkdtempSync(join(tmpdir(), "vexx-scm207-"));
    if (opts.noGit === true) {
        writeAll(repoDir, opts.committed ?? {});
        writeAll(repoDir, opts.untracked ?? {});
        return repoDir;
    }
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeAll(repoDir, opts.committed ?? {});
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    if (opts.clean !== true) {
        if (opts.modify !== undefined) writeAll(repoDir, opts.modify);
        if (opts.untracked !== undefined) writeAll(repoDir, opts.untracked);
    }
    return repoDir;
}

async function open(repoDir: string, keybindings = SWITCH_KEYS): Promise<HeadlessApp> {
    return useHeadlessApp({ open: [repoDir], keybindings, cols: 100, rows: 24 });
}

/** Строка кадра, содержащая иглу (для проверки бейджа-статуса рядом с именем). */
function lineWith(frame: string, needle: string): string {
    return frame.split("\n").find((l) => l.includes(needle)) ?? "";
}

/** Текст только внутри прямоугольника узла (колонки/строки), без соседних панелей. */
function regionText(frame: string, box: { x: number; y: number; width: number; height: number }): string {
    const lines = frame.split("\n");
    const out: string[] = [];
    for (let r = box.y; r < box.y + box.height && r < lines.length; r++) {
        out.push((lines[r] ?? "").slice(box.x, box.x + box.width));
    }
    return out.join("\n");
}

const APP_TS = ["export function greet(name: string) {", '    return "hi " + name;', "}", ""].join("\n");
const APP_TS_MOD = ["export function greet(name: string) {", '    return "hello " + name;', "}", ""].join("\n");

describe("Source Control в сайдбаре (functional e2e, PR #207)", () => {
    let app: HeadlessApp | null = null;

    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    afterEach(async () => {
        await app?.dispose();
        app = null;
    });

    it("переключает Explorer → Source Control и показывает изменённые файлы со статусами", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, modify: { "app.ts": APP_TS_MOD }, untracked: { "extra.ts": "export const answer = 42;\n" } });
        app = await open(repo);
        const { session } = app;

        // Explorer по умолчанию: файлы видны.
        await session.waitForText((t) => t.includes("EXPLORER") && t.includes("app.ts") && t.includes("extra.ts"));

        await session.key("Alt+C");
        const frame = await session
            .waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("app.ts") && t.includes("extra.ts"))
            .then(frameToText);

        expect(await session.node("#changesView")).not.toBeNull();
        // Бейджи-статусы стоят рядом с именами: M у modified, U у untracked.
        expect(lineWith(frame, "app.ts")).toContain("M");
        expect(lineWith(frame, "extra.ts")).toContain("U");
        // Список получил фокус (showViewlet reveal).
        expect(await session.focusedType()).toBe("ListViewElement");
    }, 120_000);

    it("двойной клик по modified-файлу открывает дифф «файл ↔ HEAD»", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, modify: { "app.ts": APP_TS_MOD } });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("app.ts"));
        await session.key("Alt+C");
        // Ждём НАПОЛНЕННЫЙ список (расширение публикует набор асинхронно) — иначе
        // клик по y+1 попадёт в пустой список и активации не будет.
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("app.ts"));
        const list = await session.waitForNode("#changesView");

        // Двойной клик по строке app.ts: первый ряд — заголовок группы «Changes»,
        // файл — ряд ниже. Четыре события подряд без settle — в окно двойного клика.
        const x = list.box.x + 2;
        const y = list.box.y + 1;
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });

        // Дифф открылся ЕДИНСТВЕННОЙ вкладкой: в строке вкладок ровно одно
        // упоминание app.ts (метка диффа), файловой вкладки нет.
        const frame = await session.waitForText((t) => t.includes("↔ HEAD")).then(frameToText);
        const tabsLine = lineWith(frame, "↔ HEAD");
        expect(tabsLine.split("app.ts").length - 1).toBe(1);
    }, 120_000);

    it("двойной клик по untracked-файлу открывает сам файл (сравнивать не с чем)", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, untracked: { "extra.ts": "export const answer = 42;\n" } });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("extra.ts"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("extra.ts"));
        const list = await session.waitForNode("#changesView");

        // Строки: заголовок «Changes» и extra.ts под ним — untracked едет в общей
        // группе (app.ts закоммичен без правок).
        const x = list.box.x + 2;
        const y = list.box.y + 1;
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });

        // Открылся сам файл (его контент и есть «всё новое»), диффа и notice нет.
        const frame = await session.waitForText((t) => t.includes("export const answer = 42;")).then(frameToText);
        expect(frame).not.toContain("↔ HEAD");
        expect(frame).not.toContain("No changes to compare");
    }, 120_000);

    it("клик по инлайн-кнопке строки открывает сам файл, а не дифф", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, modify: { "app.ts": APP_TS_MOD } });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("app.ts"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("app.ts"));
        const list = await session.waitForNode("#changesList");

        // Файловая строка — под заголовком группы. Кнопка Open File раскрывается
        // только на строке под указателем, поэтому сначала наводим мышь.
        const rowY = list.box.y + 1;
        await session.sendMouse({ action: "move", button: "none", x: list.box.x, y: rowY });

        // Кнопка `[  ]` занимает 5 колонок слева от буквы статуса (fixed 1).
        const buttonX = list.box.x + list.box.width - 1 - OPEN_FILE_BUTTON_WIDTH;
        await session.sendMouse({ action: "press", button: "left", x: buttonX, y: rowY });
        await session.sendMouse({ action: "release", button: "left", x: buttonX, y: rowY });

        // Открылась файловая вкладка с рабочим содержимым, диффа нет.
        const frame = await session.waitForText((t) => t.includes('"hello " + name')).then(frameToText);
        expect(frame).not.toContain("↔ HEAD");
    }, 120_000);

    it("scm.action.viewAsTree сворачивает пути в компакт-папки, viewAsList возвращает", async () => {
        const repo = makeRepo({
            committed: { "src/deep/mod.ts": "export const x = 1;\n" },
            modify: { "src/deep/mod.ts": "export const x = 2;\n" },
        });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("EXPLORER"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("src/deep/mod.ts"));

        await session.key("Alt+T");
        const box = (await session.waitForNode("#changesView")).box;
        const tree = await session
            .waitForText((t) => {
                const scm = regionText(t, box);
                return scm.includes("src/deep") && !scm.includes("src/deep/mod.ts") && scm.includes("mod.ts");
            })
            .then(frameToText);
        expect(regionText(tree, box)).toContain("src/deep"); // компакт-цепочка одним узлом

        await session.key("Alt+L");
        await session.waitForText((t) => regionText(t, box).includes("src/deep/mod.ts"));
    }, 120_000);

    it("правый клик по строке открывает контекстное меню Open File / Open Changes", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, modify: { "app.ts": APP_TS_MOD } });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("app.ts"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("app.ts"));
        const list = await session.waitForNode("#changesList");

        const x = list.box.x + 2;
        const y = list.box.y + 1; // файловая строка под заголовком группы
        await session.sendMouse({ action: "press", button: "right", x, y });
        await session.sendMouse({ action: "release", button: "right", x, y });

        const frame = await session.waitForText((t) => t.includes("Open File")).then(frameToText);
        expect(frame).toContain("Open Changes");

        // Escape закрывает меню, приложение живо.
        await session.key("Escape");
        await session.waitForText((t) => !t.includes("Open Changes"));
        expect((await session.getDocument()).root).not.toBeNull();
    }, 120_000);

    it("чистое репо без изменений — пустой список Source Control без краша", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, clean: true });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("EXPLORER"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));

        // Вьюлет есть, приложение живо; файл-изменений в списке нет.
        expect(await session.node("#changesView")).not.toBeNull();
        const frame = frameToText(await session.captureFrame());
        // В SCM-вьюлете Explorer подменён, поэтому app.ts не должен фигурировать как изменение.
        const scmSlice = frame.slice(frame.indexOf("SOURCE CONTROL"));
        expect(scmSlice).not.toContain("app.ts");
    }, 120_000);

    it("не-git папка — Source Control пустой, без краша", async () => {
        const dir = makeRepo({ noGit: true, committed: { "note.txt": "plain\n" } });
        app = await open(dir);
        const { session } = app;

        await session.waitForText((t) => t.includes("EXPLORER") && t.includes("note.txt"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));

        expect(await session.node("#changesView")).not.toBeNull();
        const frame = frameToText(await session.captureFrame());
        const scmSlice = frame.slice(frame.indexOf("SOURCE CONTROL"));
        expect(scmSlice).not.toContain("note.txt");
    }, 120_000);

    it("возврат на Explorer восстанавливает дерево файлов", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, modify: { "app.ts": APP_TS_MOD } });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("EXPLORER"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
        await session.key("Alt+X");
        await session.waitForText((t) => t.includes("EXPLORER") && t.includes("app.ts"));
        expect(await session.node("#explorer")).not.toBeNull();
        expect(await session.node("#changesView")).toBeNull();
    }, 120_000);

    it("вложенные файлы показываются путём относительно корня воркспейса", async () => {
        const repo = makeRepo({
            committed: { "src/deep/mod.ts": "export const x = 1;\n" },
            modify: { "src/deep/mod.ts": "export const x = 2;\n" },
        });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("EXPLORER"));
        await session.key("Alt+C");
        const frame = await session
            .waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("mod.ts"))
            .then(frameToText);
        // Метка — относительный путь, а не просто basename.
        expect(frame).toContain("src/deep/mod.ts");
    }, 120_000);

    it("двойной клик по удалённому файлу (status D) открывает дифф «HEAD ↔ пусто»", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, clean: true });
        // Удаляем закоммиченный файл на диске → unstaged deletion (D).
        execFileSync("rm", [join(repo, "app.ts")]);
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("EXPLORER"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("app.ts"));
        const list = await session.waitForNode("#changesView");

        const x = list.box.x + 2;
        const y = list.box.y + 1; // файловая строка под заголовком группы
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });

        // Файла на диске нет — modified-сторона пустая: вся HEAD-версия минусами,
        // ни одного плюса с содержимым.
        const frame = await session.waitForText((t) => t.includes("↔ HEAD")).then(frameToText);
        expect(frame).toContain("-  export function greet");
        expect(frame).not.toMatch(/\+ {2}\S/);
        expect(session.getStderr()).not.toMatch(/Error|Exception|unhandled/i);
    }, 120_000);

    it("список Source Control обновляется вживую после правки и сохранения файла", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, clean: true });
        const filePath = join(repo, "app.ts");
        app = await useHeadlessApp({ open: [repo, filePath], keybindings: SWITCH_KEYS, cols: 100, rows: 24 });
        const { session } = app;

        // Открыт файл + переключаемся на пустой Source Control (изменений пока нет).
        await session.waitForText((t) => t.includes("greet"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
        // Регион списка (колонки сайдбара) — чтобы имя из вкладки редактора справа
        // не считалось за изменение. Список пуст: app.ts тут пока нет.
        const box = (await session.waitForNode("#changesView")).box;
        const scmBefore = regionText(frameToText(await session.captureFrame()), box);
        expect(scmBefore).not.toContain("app.ts");

        // Правим и сохраняем файл через редактор — расширение пересчитает git status
        // по onDidSaveTextDocument и опубликует новый набор.
        await session.clickNode("EditorElement");
        await session.text("// touch\n");
        await session.key("Ctrl+S");

        // Список обязан вживую показать app.ts как изменённый (M) — без переключения.
        const listLine = await session
            .waitForText((t) => regionText(t, box).includes("app.ts"), { timeoutMs: 30_000 })
            .then((f) => lineWith(regionText(frameToText(f), box), "app.ts"));
        expect(listLine).toContain("M");
    }, 120_000);
});
