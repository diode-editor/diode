import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { quickPickByTitle, tabLabels } from "../../../../../TestUtils/domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ClipboardDIToken, FileSystemProviderRegistryDIToken } from "../../../common/coreTokens.ts";
import { DiffEditorPane } from "../../../browser/parts/editor/diffEditorPane.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { ORIGINAL_RESOURCE_COMMAND } from "../../scm/browser/commandOriginalResourceProvider.ts";
import { QUERY_COMMAND } from "../../scm/browser/syncActions.ts";

import { resetSelectedForCompare } from "./compareActions.ts";

/**
 * Семейство команд сравнения (US-3…US-7, US-9, US-12): каждая — тонкая обёртка
 * над openDiffPair, поэтому здесь проверяется именно выбор сторон и вход
 * (пикеры, меню, буфер обмена), а механика вкладки — в openDiffPair.test.ts.
 */

describe("Команды сравнения файлов", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "vexx-compare-",
            files: { "a.txt": "alpha\nbravo\n", "b.txt": "alpha\nBRAVO\n" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        resetSelectedForCompare();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function diffPanes() {
        return h.container
            .get(EditorServiceDIToken)
            .getPanes()
            .filter((p) => p instanceof DiffEditorPane);
    }

    /** Открытие вкладки асинхронно (чтение сторон); под нагрузкой 10мс мало. */
    async function settleUntilDiff(): Promise<void> {
        for (let i = 0; i < 50 && diffPanes().length === 0; i++) await settle(10);
        h.testApp.render();
    }

    async function openAndEdit(name: string): Promise<void> {
        h.commands.execute("workbench.openFile", ws.path(name));
        await settle(0);
        const editor = h.container.get(EditorServiceDIToken).getActiveEditor();
        editor?.goToPosition(1, 0);
        editor?.viewState.type("XX");
        h.testApp.render();
    }

    describe("Compare with Saved (US-6)", () => {
        it("открывает дифф «диск ↔ буфер» с подписями сторон", async () => {
            await openAndEdit("a.txt");

            h.commands.execute("workbench.files.action.compareWithSaved");
            await settleUntilDiff();

            const screen = h.testApp.backend.screenToString();
            expect(screen).toContain("a.txt (on disk) ↔ a.txt");
            expect(screen).toContain("-  bravo");
            expect(screen).toContain("+  XXbravo");
        });

        it("файл без правок даёт вкладку «The files are identical» (US-11)", async () => {
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("workbench.files.action.compareWithSaved");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("The files are identical");
        });

        it("untitled-буфер получает нотис вместо вкладки", async () => {
            h.commands.execute("workbench.action.files.newUntitledFile");
            await settle(0);

            h.commands.execute("workbench.files.action.compareWithSaved");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("no saved version on disk");
            expect(diffPanes()).toHaveLength(0);
        });
    });

    describe("Compare with Clipboard (US-5)", () => {
        it("сравнивает содержимое буфера обмена с активным файлом", async () => {
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);
            await h.container.get(ClipboardDIToken).writeText("alpha\nCLIP\n");

            h.commands.execute("workbench.files.action.compareWithClipboard");
            await settleUntilDiff();

            const screen = h.testApp.backend.screenToString();
            expect(screen).toContain("Clipboard ↔ a.txt");
            expect(screen).toContain("-  CLIP");
            expect(screen).toContain("+  bravo");
        });

        it("пустой буфер — сравнение с пустым, а не ошибка", async () => {
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("workbench.files.action.compareWithClipboard");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toMatch(/\+ {2}alpha/u);
        });
    });

    describe("Select for Compare / Compare with Selected (US-4)", () => {
        it("пара из Explorer-меню открывает дифф, выбранный первым — слева", async () => {
            h.commands.execute("selectForCompare", ws.path("a.txt"));
            expect(h.container.get(ContextKeyServiceDIToken).evaluate("resourceSelectedForCompare")).toBe(true);

            h.commands.execute("compareFiles", ws.path("b.txt"));
            await settleUntilDiff();

            const screen = h.testApp.backend.screenToString();
            expect(screen).toContain("a.txt ↔ b.txt");
            expect(screen).toContain("-  bravo");
            expect(screen).toContain("+  BRAVO");
        });

        it("до Select for Compare команда Compare with Selected — тихий no-op", async () => {
            h.commands.execute("compareFiles", ws.path("b.txt"));
            await settle(10);

            expect(diffPanes()).toHaveLength(0);
        });

        it("правый файл исчез с диска — нотис вместо вкладки", async () => {
            h.commands.execute("selectForCompare", ws.path("a.txt"));
            const { rmSync } = await import("node:fs");
            rmSync(ws.path("b.txt"));

            h.commands.execute("compareFiles", ws.path("b.txt"));
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("file is not readable");
            expect(diffPanes()).toHaveLength(0);
        });

        it("повторный Select for Compare заменяет отложенный файл", async () => {
            h.commands.execute("selectForCompare", ws.path("a.txt"));
            h.commands.execute("selectForCompare", ws.path("b.txt"));

            h.commands.execute("compareFiles", ws.path("a.txt"));
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("b.txt ↔ a.txt");
        });
    });

    describe("Compare Active File With… (US-3, US-9)", () => {
        it("пикер открывает дифф с выбранным файлом, активный — слева", async () => {
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("workbench.files.action.compareFileWith");
            await settleUntilDiff();

            const picker = quickPickByTitle(h.testApp, "Compare Active File With…");
            const items = picker.items;
            const bIndex = items.findIndex((i) => i.label === "b.txt");
            expect(bIndex).toBeGreaterThanOrEqual(0);
            picker.setActiveIndex(bIndex);
            h.testApp.sendKey("Enter");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("a.txt ↔ b.txt");
        });

        it("Esc в пикере ничего не открывает", async () => {
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("workbench.files.action.compareFileWith");
            await settleUntilDiff();
            h.testApp.sendKey("Escape");
            await settle(10);

            expect(diffPanes()).toHaveLength(0);
        });
    });

    describe("Compare with Revision (US-7)", () => {
        function stubGit(refs: { name: string; kind: string; sha: string; subject: string }[]): {
            requestedRefs: string[];
        } {
            const requestedRefs: string[] = [];
            h.commands.register(QUERY_COMMAND, () => ({ refs }));
            h.commands.register(ORIGINAL_RESOURCE_COMMAND, (raw, ref) => {
                requestedRefs.push(String(ref));
                return Uri.from({
                    scheme: "git",
                    path: String(raw).replace("file://", ""),
                    query: JSON.stringify({ ref: String(ref) }),
                }).toString();
            });
            return { requestedRefs };
        }

        it("пикер ref'ов открывает дифф против выбранной ревизии", async () => {
            const git = stubGit([{ name: "dev", kind: "head", sha: "abc1234def", subject: "wip" }]);
            h.container.get(FileSystemProviderRegistryDIToken).registerProvider("git", {
                readFile: () => Promise.resolve(new TextEncoder().encode("alpha\nDEV\n")),
                onDidChangeFile: () => ({ dispose: () => undefined }),
            });
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("vexx.scm.compareWithRevision");
            await settleUntilDiff();

            const picker = quickPickByTitle(h.testApp, "Compare Active File with Revision");
            expect(picker.items.map((i) => i.label)).toContain("dev");
            h.testApp.sendKey("Enter");
            await settleUntilDiff();

            // Провайдер оригинала получил именно выбранный ref — тест продюсера.
            // (Первый вызов без ref — это live-гуттер при открытии файла.)
            expect(git.requestedRefs.at(-1)).toBe("dev");
            const screen = h.testApp.backend.screenToString();
            expect(screen).toContain("a.txt ↔ dev");
            expect(screen).toContain("-  DEV");
        });

        it("нет ref'ов — нотис, пикер не открывается", async () => {
            stubGit([]);
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("vexx.scm.compareWithRevision");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("No refs to compare");
            expect(diffPanes()).toHaveLength(0);
        });
    });

    describe("границы команд", () => {
        it("без активного редактора все команды — тихие no-op", async () => {
            h.commands.execute("workbench.files.action.compareWithSaved");
            h.commands.execute("workbench.files.action.compareWithClipboard");
            h.commands.execute("workbench.files.action.compareFileWith");
            h.commands.execute("vexx.scm.compareWithRevision");
            await settle(10);

            expect(diffPanes()).toHaveLength(0);
        });

        it("selectForCompare без пути не взводит ключ, compareFiles без пути — no-op", async () => {
            h.commands.execute("selectForCompare");
            expect(h.container.get(ContextKeyServiceDIToken).evaluate("resourceSelectedForCompare")).toBe(false);

            h.commands.execute("selectForCompare", ws.path("a.txt"));
            h.commands.execute("compareFiles");
            await settle(10);
            expect(diffPanes()).toHaveLength(0);
        });

        it("Saved: файл исчез с диска — нотис вместо вкладки", async () => {
            await openAndEdit("a.txt");
            const { rmSync } = await import("node:fs");
            rmSync(ws.path("a.txt"));

            h.commands.execute("workbench.files.action.compareWithSaved");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("not readable from disk");
            expect(diffPanes()).toHaveLength(0);
        });
    });

    describe("Compare Active File With… — состав пикера", () => {
        it("открытая вкладка показывается один раз с бейджем open (US-9)", async () => {
            h.commands.execute("workbench.openFile", ws.path("b.txt"));
            await settle(0);
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("workbench.files.action.compareFileWith");
            await settleUntilDiff();

            const picker = quickPickByTitle(h.testApp, "Compare Active File With…");
            const bItems = picker.items.filter((i) => i.label === "b.txt");
            // b.txt открыт и есть в индексе поиска — но в списке он один, с бейджем.
            expect(bItems).toHaveLength(1);
            expect(bItems[0].badge).toBe("open");
            h.testApp.sendKey("Escape");
        });

        it("выбранный файл исчез с диска — нотис вместо вкладки", async () => {
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("workbench.files.action.compareFileWith");
            await settleUntilDiff();

            // Файл пропадает МЕЖДУ открытием пикера и выбором — список его ещё помнит.
            const { rmSync } = await import("node:fs");
            rmSync(ws.path("b.txt"));
            const picker = quickPickByTitle(h.testApp, "Compare Active File With…");
            picker.setActiveIndex(picker.items.findIndex((i) => i.label === "b.txt"));
            h.testApp.sendKey("Enter");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("file is not readable");
            expect(diffPanes()).toHaveLength(0);
        });
    });

    describe("Compare with Revision — текущая ветка", () => {
        it("текущая ветка помечена бейджем current", async () => {
            h.commands.register(QUERY_COMMAND, () => ({
                refs: [
                    { name: "main", kind: "head", sha: "abc1234def", subject: "tip" },
                    { name: "dev", kind: "head", sha: "def5678abc", subject: "wip" },
                ],
            }));
            h.commands.execute("vexx.scm.publishRepoState", {
                branch: "main",
                detached: false,
                upstream: "origin/main",
                ahead: 0,
                behind: 0,
                remotes: ["origin"],
                state: "idle",
            });
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("vexx.scm.compareWithRevision");
            await settleUntilDiff();

            const picker = quickPickByTitle(h.testApp, "Compare Active File with Revision");
            const main = picker.items.find((i) => i.label === "main");
            const dev = picker.items.find((i) => i.label === "dev");
            expect(main?.badge).toBe("current");
            expect(dev?.badge).toBeUndefined();
            h.testApp.sendKey("Escape");
            await settle(10);
            expect(diffPanes()).toHaveLength(0);
        });

        it("провайдер оригинала бросил — нотис «no version in git»", async () => {
            h.commands.register(QUERY_COMMAND, () => ({
                refs: [{ name: "dev", kind: "head", sha: "abc", subject: "x" }],
            }));
            h.commands.register(ORIGINAL_RESOURCE_COMMAND, () => {
                throw new Error("git exploded");
            });
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("vexx.scm.compareWithRevision");
            await settleUntilDiff();
            h.testApp.sendKey("Enter");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("no version in git");
            expect(diffPanes()).toHaveLength(0);
        });
    });

    describe("vscode.diff (US-12)", () => {
        it("открывает дифф по паре uri-строк с переданным title", async () => {
            h.commands.execute(
                "vscode.diff",
                Uri.file(ws.path("a.txt")).toString(),
                Uri.file(ws.path("b.txt")).toString(),
                "Left ↔ Right",
            );
            await settleUntilDiff();

            expect(tabLabels(h.testApp).some((l) => l.includes("Left ↔ Right"))).toBe(true);
            expect(h.testApp.backend.screenToString()).toContain("+  BRAVO");
        });

        it("принимает Uri-объекты, без title метка собирается из имён", async () => {
            h.commands.execute("vscode.diff", Uri.file(ws.path("a.txt")), Uri.file(ws.path("b.txt")));
            await settleUntilDiff();

            expect(tabLabels(h.testApp).some((l) => l.includes("a.txt ↔ b.txt"))).toBe(true);
        });

        it("мусорные аргументы — тихий no-op", async () => {
            h.commands.execute("vscode.diff", 42, { not: "a uri" });
            h.commands.execute("vscode.diff", Uri.file(ws.path("a.txt")).toString(), "");
            await settle(10);

            expect(diffPanes()).toHaveLength(0);
        });
    });
});
