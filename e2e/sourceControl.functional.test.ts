import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { frameToText } from "./helpers/frame.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Функциональные e2e для PR #207 (Source Control в сайдбаре): чёрным ящиком через
// инспектор настоящего бинаря. Проверяем заявленное поведение и крайние случаи:
// переключение Explorer↔SCM, список изменений, дифф по двойному клику, untracked,
// чистое репо, не-git папка, относительные пути, реальный кейбинд ctrl+shift+g.

// Переключатели вьюлетов — user-кейбиндами (детерминированно, без палитры). Буквы
// НЕ мнемонические (F/E/S/V/G/H — меню-бар), как в sourceControl.scenario.
const SWITCH_KEYS = [
    { key: "alt+c", command: "workbench.view.scm" },
    { key: "alt+x", command: "workbench.view.explorer" },
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
        expect(await session.focusedType()).toBe("TreeViewElement");
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

        // Двойной клик по первой строке (app.ts, modified). Строка под заголовком
        // рамки → y+1. Четыре события подряд без settle — в окно двойного клика.
        const x = list.box.x + 2;
        const y = list.box.y + 1;
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });

        await session.waitForText((t) => t.includes("↔ HEAD"));
        // Дифф показывает изменённую строку.
        const frame = frameToText(await session.captureFrame());
        expect(frame).toContain("↔ HEAD");
    }, 120_000);

    it("двойной клик по untracked-файлу не падает и показывает уведомление вместо диффа", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, untracked: { "extra.ts": "export const answer = 42;\n" } });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("extra.ts"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("extra.ts"));
        const list = await session.waitForNode("#changesView");

        // Единственная строка списка — extra.ts (untracked): app.ts закоммичен без правок.
        const x = list.box.x + 2;
        const y = list.box.y + 1;
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });

        // Уведомление в статус-баре, диффа НЕТ, приложение живо.
        const frame = await session.waitForText((t) => t.includes("No changes to compare")).then(frameToText);
        expect(frame).not.toContain("↔ HEAD");
        expect(await session.getDocument()).not.toBeNull();
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

    it("двойной клик по удалённому файлу (status D) не роняет приложение", async () => {
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
        const y = list.box.y + 1;
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });

        // Не проверяем, открылся ли дифф (файла на диске нет — поведение на выбор
        // реализации): важно, что приложение живо и отвечает инспектору.
        await session.waitForIdle();
        expect((await session.getDocument()).root).not.toBeNull();
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
