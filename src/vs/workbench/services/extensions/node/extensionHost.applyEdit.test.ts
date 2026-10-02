import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";

// `vscode.workspace.applyEdit` end-to-end с настоящим субпроцессом: расширение
// строит WorkspaceEdit, правки доезжают до буферов ядра и до файлов на диске.
// Это фундамент для code actions / rename (#196).

const FIXTURE = extensionFixture("test.appliesWorkspaceEdit", "appliesWorkspaceEdit.cjs");

// Удаление файла уходит в системную корзину (`files.enableTrash` по умолчанию
// включён) — уводим её в tmp, чтобы прогон не писал в корзину разработчика.
let savedXdg: string | undefined;

beforeEach(() => {
    savedXdg = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "diode-applyedit-xdg-"));
});

afterEach(() => {
    const isolated = process.env.XDG_DATA_HOME;
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (isolated !== undefined && isolated !== savedXdg) fs.rmSync(isolated, { recursive: true, force: true });
});

describe("ExtensionHost — workspace.applyEdit (subprocess)", () => {
    it("правка активного документа применяется и откатывается одним undo", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "hello\nworld" },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const applied = await harness.commandRegistry.execute("test.applyReplaceActive");
            await settle();
            expect(applied).toBe(true);
            expect(harness.group.getActiveEditor()?.getText()).toBe("HELLO\nworld");

            harness.group.getActiveEditor()?.undo();
            expect(harness.group.getActiveEditor()?.getText()).toBe("hello\nworld");
        } finally {
            await harness.dispose();
        }
    });

    it("multi-file edit применяется ко ВСЕМ открытым документам, включая неактивные", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "alpha" },
            extensions: [FIXTURE],
        });
        try {
            const second = harness.writeFile("b.txt", "beta");
            harness.group.openFile(second);
            await settle();

            const first = harness.group
                .getEditors()
                .find((editor) => editor.uri.toString() !== Uri.file(second).toString());
            expect(first).toBeDefined();

            const applied = await harness.commandRegistry.execute("test.applyToFiles", [first!.uri.fsPath, second]);
            await settle();
            expect(applied).toBe(true);
            expect(first?.getText()).toBe("Xalpha");
            expect(harness.group.getActiveEditor()?.getText()).toBe("Xbeta");
        } finally {
            await harness.dispose();
        }
    });

    /**
     * Узел M1 целиком: правка файла, которого нет ни в одной вкладке. Раньше
     * такой edit честно отвечал `false`, и пользователь видел «Code action
     * failed» на любом действии, трогающем второй файл.
     */
    it("ЗАКРЫТЫЙ файл правится на диске, а открытый — в буфере; один undo откатывает оба", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "alpha" },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const closed = harness.writeFile("closed.txt", "beta");
            const active = harness.group.getActiveEditor();
            expect(harness.group.getEditors().map((e) => e.uri.fsPath)).not.toContain(closed);

            const applied = await harness.commandRegistry.execute("test.applyToFiles", [active!.uri.fsPath, closed]);
            await settle();

            expect(applied).toBe(true);
            expect(active?.getText()).toBe("Xalpha");
            expect(fs.readFileSync(closed, "utf8")).toBe("Xbeta");
            // Открытый буфер «грязный» (на диске ещё старое), закрытый файл уже
            // записан: буфера у него нет, и грязным он быть не может.
            expect(active?.isModified).toBe(true);

            // ОДИН Ctrl+Z на весь edit: откатывается и буфер, и файл на диске.
            active?.undo();
            expect(active?.getText()).toBe("alpha");
            expect(fs.readFileSync(closed, "utf8")).toBe("beta");
        } finally {
            await harness.dispose();
        }
    });

    it("несуществующий ресурс отменяет весь edit — false, буферы и диск не тронуты", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "alpha" },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const active = harness.group.getActiveEditor();
            const applied = await harness.commandRegistry.execute("test.applyToFiles", [
                active!.uri.fsPath,
                path.join(harness.tmpDir, "nowhere", "closed.txt"),
            ]);
            await settle();
            expect(applied).toBe(false);
            expect(active?.getText()).toBe("alpha");
        } finally {
            await harness.dispose();
        }
    });

    it("edit с переименованием файла применяется целиком: текст в буфере, файл на новом пути", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "alpha" },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const from = harness.writeFile("old.txt", "payload");
            const to = path.join(harness.tmpDir, "new.txt");
            const active = harness.group.getActiveEditor();

            const applied = await harness.commandRegistry.execute("test.applyRenameWithText", [from, to]);
            await settle();

            expect(applied).toBe(true);
            expect(active?.getText()).toBe("Ylpha");
            expect(fs.existsSync(from)).toBe(false);
            expect(fs.readFileSync(to, "utf8")).toBe("payload");
        } finally {
            await harness.dispose();
        }
    });

    it("«Move to a new file»: создание с содержимым, правка нового файла и удаление старого", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "alpha" },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const created = path.join(harness.tmpDir, "moved", "target.txt");
            const removed = harness.writeFile("source.txt", "gone");

            const applied = await harness.commandRegistry.execute("test.applyMoveToNewFile", [created, removed]);
            await settle();

            expect(applied).toBe(true);
            expect(fs.readFileSync(created, "utf8")).toBe("moved\ntail\n");
            expect(fs.existsSync(removed)).toBe(false);
        } finally {
            await harness.dispose();
        }
    });
});
