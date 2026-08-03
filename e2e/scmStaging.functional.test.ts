import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { frameToText } from "./helpers/frame.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Функциональные e2e стейджинга (спека docs/TODO/SourceControl.md, US-1…US-9,
// US-12): группы ресурсов, stage/unstage из контекстного меню (строка, заголовок
// группы, палитро-команды stageAll/unstageAll), multi-select. Git-ассерты —
// строго после того, как UI-предикат подтвердил завершение операции.

const SWITCH_KEYS = [
    { key: "alt+c", command: "workbench.view.scm" },
    { key: "alt+a", command: "git.stageAll" },
    { key: "alt+u", command: "git.unstageAll" },
];

function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd }).toString();
}

function gitQ(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

interface RepoFiles {
    committed?: Record<string, string>;
    modify?: Record<string, string>;
    staged?: Record<string, string>;
    untracked?: Record<string, string>;
}

function writeAll(repoDir: string, files: Record<string, string>): void {
    for (const [rel, content] of Object.entries(files)) {
        const file = join(repoDir, rel);
        execFileSync("mkdir", ["-p", join(file, "..")]);
        writeFileSync(file, content);
    }
}

function makeRepo(opts: RepoFiles): string {
    const repoDir = mkdtempSync(join(tmpdir(), "vexx-scm-stage-"));
    gitQ(repoDir, "init", "-q");
    gitQ(repoDir, "config", "user.email", "t@example.com");
    gitQ(repoDir, "config", "user.name", "Test");
    gitQ(repoDir, "config", "commit.gpgsign", "false");
    writeAll(repoDir, opts.committed ?? {});
    gitQ(repoDir, "add", "-A");
    gitQ(repoDir, "commit", "-qm", "init");
    if (opts.staged !== undefined) {
        writeAll(repoDir, opts.staged);
        gitQ(repoDir, "add", "-A");
    }
    if (opts.modify !== undefined) writeAll(repoDir, opts.modify);
    if (opts.untracked !== undefined) writeAll(repoDir, opts.untracked);
    return repoDir;
}

async function open(repoDir: string): Promise<HeadlessApp> {
    return useHeadlessApp({ open: [repoDir], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
}

/** Текст только внутри прямоугольника узла — без соседних панелей. */
function regionText(frame: string, box: { x: number; y: number; width: number; height: number }): string {
    const lines = frame.split("\n");
    const out: string[] = [];
    for (let r = box.y; r < box.y + box.height && r < lines.length; r++) {
        out.push((lines[r] ?? "").slice(box.x, box.x + box.width));
    }
    return out.join("\n");
}

const A = 'export const a = "one";\n';
const A_MOD = 'export const a = "two";\n';

/** Кликает по пункту открытого меню, найдя его текст в кадре. */
async function clickMenuItem(session: HeadlessApp["session"], label: string): Promise<void> {
    const frame = await session.waitForText((t) => t.includes(label));
    const lines = frameToText(frame).split("\n");
    const row = lines.findIndex((l) => l.includes(label));
    const col = lines[row].indexOf(label);
    await session.click(col + 1, row);
}

describe("SCM staging (functional e2e, спека SourceControl.md)", () => {
    let app: HeadlessApp | null = null;

    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    afterEach(async () => {
        await app?.dispose();
        app = null;
    });

    it("US-1: группы Staged/Changes/Untracked с корректным разнесением, MM — в двух группах", async () => {
        const repo = makeRepo({
            committed: { "mm.ts": A, "plain.ts": A },
            staged: { "mm.ts": A_MOD },
            untracked: { "new.ts": "export {};\n" },
        });
        // Поверх staged-версии — ещё одна правка: mm.ts становится MM.
        writeFileSync(join(repo, "mm.ts"), 'export const a = "three";\n');
        writeFileSync(join(repo, "plain.ts"), A_MOD);
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("Staged Changes"));
        await session.waitForNode("#scmGroup-index");
        await session.waitForNode("#scmGroup-worktree");
        await session.waitForNode("#scmGroup-untracked");
        // MM-файл присутствует в обеих группах.
        await session.waitForNode("#scmRow-index-mm-ts");
        await session.waitForNode("#scmRow-worktree-mm-ts");
        // Порядок секций: Staged выше Changes, Changes выше Untracked.
        const staged = (await session.node("#scmGroup-index"))!.box;
        const worktree = (await session.node("#scmGroup-worktree"))!.box;
        const untracked = (await session.node("#scmGroup-untracked"))!.box;
        expect(staged.y).toBeLessThan(worktree.y);
        expect(worktree.y).toBeLessThan(untracked.y);
    }, 120_000);

    it("US-2/US-3: stage из контекстного меню, затем unstage — строка мигрирует между группами", async () => {
        const repo = makeRepo({ committed: { "app.ts": A }, modify: { "app.ts": A_MOD } });
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("app.ts"));
        const row = await session.waitForNode("#scmRow-worktree-app-ts");

        // Правый клик по строке → Stage Changes.
        await session.sendMouse({ action: "press", button: "right", x: row.box.x + 2, y: row.box.y });
        await session.sendMouse({ action: "release", button: "right", x: row.box.x + 2, y: row.box.y });
        await clickMenuItem(session, "Stage Changes");

        // Строка переехала в Staged Changes; git подтверждает.
        await session.waitForNode("#scmRow-index-app-ts");
        await session.waitForNoNode("#scmRow-worktree-app-ts");
        expect(git(repo, "diff", "--cached", "--name-only").trim()).toBe("app.ts");

        // Unstage через контекстное меню staged-строки.
        const stagedRow = await session.waitForNode("#scmRow-index-app-ts");
        await session.sendMouse({ action: "press", button: "right", x: stagedRow.box.x + 2, y: stagedRow.box.y });
        await session.sendMouse({ action: "release", button: "right", x: stagedRow.box.x + 2, y: stagedRow.box.y });
        await clickMenuItem(session, "Unstage Changes");

        await session.waitForNode("#scmRow-worktree-app-ts");
        await session.waitForNoNode("#scmRow-index-app-ts");
        expect(git(repo, "diff", "--cached", "--name-only").trim()).toBe("");
    }, 120_000);

    it("US-5: Stage All Changes с заголовка группы стейджит всю группу", async () => {
        const repo = makeRepo({
            committed: { "a.ts": A, "b.ts": A },
            modify: { "a.ts": A_MOD, "b.ts": A_MOD },
        });
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("a.ts"));
        const header = await session.waitForNode("#scmGroup-worktree");

        await session.sendMouse({ action: "press", button: "right", x: header.box.x + 2, y: header.box.y });
        await session.sendMouse({ action: "release", button: "right", x: header.box.x + 2, y: header.box.y });
        await clickMenuItem(session, "Stage All Changes");

        await session.waitForNode("#scmGroup-index");
        await session.waitForNoNode("#scmGroup-worktree");
        expect(git(repo, "diff", "--cached", "--name-only").trim().split("\n").sort()).toEqual(["a.ts", "b.ts"]);
    }, 120_000);

    it("US-6: git.stageAll / git.unstageAll из команд (untracked стейджится тоже)", async () => {
        const repo = makeRepo({
            committed: { "a.ts": A },
            modify: { "a.ts": A_MOD },
            untracked: { "new.ts": "export {};\n" },
        });
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("a.ts"));
        await session.waitForNode("#scmGroup-worktree");

        await session.key("Alt+A"); // git.stageAll
        await session.waitForNoNode("#scmGroup-worktree");
        await session.waitForNoNode("#scmGroup-untracked");
        await session.waitForNode("#scmGroup-index");
        expect(git(repo, "diff", "--cached", "--name-only").trim().split("\n").sort()).toEqual(["a.ts", "new.ts"]);

        await session.key("Alt+U"); // git.unstageAll
        await session.waitForNoNode("#scmGroup-index");
        await session.waitForNode("#scmGroup-worktree");
        await session.waitForNode("#scmGroup-untracked");
        expect(git(repo, "diff", "--cached", "--name-only").trim()).toBe("");
    }, 120_000);

    it("US-7/US-8: multi-select Shift/Ctrl и stage ровно выбранного", async () => {
        const repo = makeRepo({
            committed: { "a.ts": A, "b.ts": A, "c.ts": A },
            modify: { "a.ts": A_MOD, "b.ts": A_MOD, "c.ts": A_MOD },
        });
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("a.ts"));
        const rowA = await session.waitForNode("#scmRow-worktree-a-ts");

        // Клик по a.ts, Shift+Down дважды: выделены a, b, c.
        await session.click(rowA.box.x + 2, rowA.box.y);
        await session.key("Shift+Down");
        await session.key("Shift+Down");
        await session.waitForState("#changesList", (s) => ((s as { selectedIds?: string[] })?.selectedIds?.length ?? 0) === 3);

        // Ctrl+клик по b.ts снимает её: остаются a и c.
        const rowB = await session.waitForNode("#scmRow-worktree-b-ts");
        await session.sendMouse({ action: "press", button: "left", x: rowB.box.x + 2, y: rowB.box.y, ctrlKey: true });
        await session.sendMouse({ action: "release", button: "left", x: rowB.box.x + 2, y: rowB.box.y, ctrlKey: true });
        await session.waitForState("#changesList", (s) => {
            const ids = (s as { selectedIds?: string[] })?.selectedIds ?? [];
            return ids.length === 2 && !ids.includes("scmRow-worktree-b-ts");
        });

        // Shift+F10 → Stage Changes по выделению: staged ровно a и c.
        await session.key("Shift+F10");
        await clickMenuItem(session, "Stage Changes");

        await session.waitForNode("#scmRow-index-a-ts");
        await session.waitForNode("#scmRow-index-c-ts");
        await session.waitForNode("#scmRow-worktree-b-ts");
        expect(git(repo, "diff", "--cached", "--name-only").trim().split("\n").sort()).toEqual(["a.ts", "c.ts"]);
    }, 120_000);

    it("US-12: наборы пунктов контекстного меню по группам; Esc закрывает без действий", async () => {
        const repo = makeRepo({
            committed: { "st.ts": A, "wt.ts": A },
            staged: { "st.ts": A_MOD },
            modify: { "wt.ts": A_MOD },
            untracked: { "new.ts": "export {};\n" },
        });
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("st.ts"));

        // Staged-строка: Unstage есть, Stage нет.
        const stagedRow = await session.waitForNode("#scmRow-index-st-ts");
        await session.sendMouse({ action: "press", button: "right", x: stagedRow.box.x + 2, y: stagedRow.box.y });
        await session.sendMouse({ action: "release", button: "right", x: stagedRow.box.x + 2, y: stagedRow.box.y });
        let frame = frameToText(await session.waitForText((t) => t.includes("Unstage Changes")));
        expect(frame).toContain("Open File");
        // «Stage Changes» (с большой S) — не подстрока «Unstage Changes».
        expect(frame).not.toContain("Stage Changes");
        await session.key("Escape");
        await session.waitForText((t) => !t.includes("Unstage Changes"));

        // Worktree-строка: Stage есть.
        const wtRow = await session.waitForNode("#scmRow-worktree-wt-ts");
        await session.sendMouse({ action: "press", button: "right", x: wtRow.box.x + 2, y: wtRow.box.y });
        await session.sendMouse({ action: "release", button: "right", x: wtRow.box.x + 2, y: wtRow.box.y });
        frame = frameToText(await session.waitForText((t) => t.includes("Stage Changes")));
        expect(frame).toContain("Open Changes");
        await session.key("Escape");
        await session.waitForText((t) => !t.includes("Stage Changes"));

        // Ничего не изменилось: индекс ровно с st.ts.
        expect(git(repo, "diff", "--cached", "--name-only").trim()).toBe("st.ts");
    }, 120_000);
});
