import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";

import type { IWorkspaceScanner } from "./workspaceContainsActivation.ts";

/**
 * Активация по `workspaceContains:<паттерн>`: повод считается ПО ФС, а не
 * сравнением строк, и считается для каждого манифеста отдельно (паттерн —
 * аргумент события, и подошёл он конкретному расширению).
 *
 * Папка воркспейса у харнесса — его `tmpDir`, поэтому фикстуры кладём туда
 * настоящими файлами (`writeFile`): проверяем ровно тот путь, по которому
 * ходит прод. Для проверки семантики обхода есть юниты
 * `workspaceContainsActivation.test.ts` — здесь интересен только хост.
 */
describe("ExtensionHost — активация по workspaceContains:", () => {
    it("паттерн-путь сошёлся с файлом в папке воркспейса → расширение активно", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.maven", "noopExtension.cjs"),
                    activationEvents: ["workspaceContains:pom.xml"],
                },
            ],
        });
        try {
            harness.writeFile("pom.xml", "<project/>");
            expect(harness.host.hasExtension("test.maven")).toBe(false);

            await harness.host.activateByWorkspaceContains();
            await settle();
            expect(harness.host.hasExtension("test.maven")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("паттерн-glob сошёлся на первом уровне дерева", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.multimodule", "noopExtension.cjs"),
                    activationEvents: ["workspaceContains:*/pom.xml"],
                },
            ],
        });
        try {
            fs.mkdirSync(path.join(harness.tmpDir, "module-a"));
            fs.writeFileSync(path.join(harness.tmpDir, "module-a", "pom.xml"), "<project/>");

            await harness.host.activateByWorkspaceContains();
            await settle();
            expect(harness.host.hasExtension("test.multimodule")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("ни один паттерн не сошёлся → расширение осталось неактивным, субпроцесс не поднят", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.nomatch", "noopExtension.cjs"),
                    activationEvents: ["workspaceContains:pom.xml", "workspaceContains:*/build.gradle"],
                },
            ],
        });
        try {
            harness.writeFile("package.json", "{}");
            await harness.host.activateByWorkspaceContains();
            await settle();
            expect(harness.host.hasExtension("test.nomatch")).toBe(false);
            expect(harness.host.extensionCount).toBe(0);
        } finally {
            await harness.dispose();
        }
    });

    it("считается ПО РАСШИРЕНИЮ: подошедший паттерн поднимает только своего хозяина", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.java", "noopExtension.cjs"),
                    activationEvents: ["workspaceContains:pom.xml"],
                },
                {
                    ...extensionFixture("test.python", "noopExtension.cjs"),
                    activationEvents: ["workspaceContains:pyproject.toml"],
                },
            ],
        });
        try {
            harness.writeFile("pom.xml", "<project/>");
            await harness.host.activateByWorkspaceContains();
            await settle();
            expect(harness.host.hasExtension("test.java")).toBe(true);
            expect(harness.host.hasExtension("test.python")).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("идемпотентно: второй проход не активирует повторно и не читает ФС снова", async () => {
        const scanner = spyScanner();
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            workspaceScanner: scanner.scanner,
            extensions: [
                {
                    ...extensionFixture("test.idempotent", "noopExtension.cjs"),
                    activationEvents: ["workspaceContains:pom.xml"],
                },
            ],
        });
        try {
            await harness.host.activateByWorkspaceContains();
            await settle();
            expect(harness.host.extensionCount).toBe(1);
            const callsAfterFirst = scanner.exists.mock.calls.length;

            await harness.host.activateByWorkspaceContains();
            await settle();
            expect(harness.host.extensionCount).toBe(1);
            // Расширение ушло из pending — кандидатов нет, ФС не трогали.
            expect(scanner.exists.mock.calls.length).toBe(callsAfterFirst);
        } finally {
            await harness.dispose();
        }
    });

    it("ЛЕНИВОСТЬ: файл появился позже — повторный проход поднимает расширение", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                {
                    ...extensionFixture("test.later", "noopExtension.cjs"),
                    activationEvents: ["workspaceContains:pom.xml"],
                },
            ],
        });
        try {
            await harness.host.activateByWorkspaceContains();
            await settle();
            expect(harness.host.hasExtension("test.later")).toBe(false);

            harness.writeFile("pom.xml", "<project/>");
            await harness.host.activateByWorkspaceContains();
            await settle();
            expect(harness.host.hasExtension("test.later")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("без кандидатов ФС не трогается вовсе", async () => {
        const scanner = spyScanner();
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            workspaceScanner: scanner.scanner,
            extensions: [
                {
                    ...extensionFixture("test.other", "noopExtension.cjs"),
                    activationEvents: ["onStartupFinished"],
                },
            ],
        });
        try {
            await harness.host.activateByWorkspaceContains();
            expect(scanner.exists).not.toHaveBeenCalled();
            expect(scanner.readDirectory).not.toHaveBeenCalled();
            expect(harness.host.hasExtension("test.other")).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("сканер бросил — активация соседей не срывается", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            workspaceScanner: {
                exists: (absolutePath) =>
                    absolutePath.endsWith("boom.txt")
                        ? Promise.reject(new Error("boom"))
                        : Promise.resolve(absolutePath.endsWith("pom.xml")),
                readDirectory: () => Promise.resolve([]),
            },
            extensions: [
                {
                    ...extensionFixture("test.broken", "noopExtension.cjs"),
                    activationEvents: ["workspaceContains:boom.txt"],
                },
                {
                    ...extensionFixture("test.healthy", "noopExtension.cjs"),
                    activationEvents: ["workspaceContains:pom.xml"],
                },
            ],
        });
        try {
            await harness.host.activateByWorkspaceContains();
            await settle();
            expect(harness.host.hasExtension("test.broken")).toBe(false);
            expect(harness.host.hasExtension("test.healthy")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("не-file: папка воркспейса пропускается — обходить её нашим сканером нечем", async () => {
        const scanner = spyScanner();
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            workspaceScanner: scanner.scanner,
            workspaceFolders: [{ uri: "vscode-remote://ssh/repo", name: "repo", index: 0 }],
            extensions: [
                {
                    ...extensionFixture("test.remote", "noopExtension.cjs"),
                    activationEvents: ["workspaceContains:pom.xml"],
                },
            ],
        });
        try {
            await harness.host.activateByWorkspaceContains();
            await settle();
            expect(scanner.exists).not.toHaveBeenCalled();
            expect(harness.host.hasExtension("test.remote")).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("`file:`-папка доезжает до сканера настоящим путём, а не строкой uri", async () => {
        const scanner = spyScanner();
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            workspaceScanner: scanner.scanner,
            extensions: [
                {
                    ...extensionFixture("test.path", "noopExtension.cjs"),
                    activationEvents: ["workspaceContains:pom.xml"],
                },
            ],
        });
        try {
            await harness.host.activateByWorkspaceContains();
            await settle();
            expect(scanner.exists).toHaveBeenCalledWith(path.join(harness.tmpDir, "pom.xml"));
        } finally {
            await harness.dispose();
        }
    });
});

/** Сканер, отвечающий «есть только pom.xml», со счётчиками обращений. */
function spyScanner(): {
    scanner: IWorkspaceScanner;
    exists: ReturnType<typeof vi.fn>;
    readDirectory: ReturnType<typeof vi.fn>;
} {
    const exists = vi.fn((absolutePath: string) => Promise.resolve(absolutePath.endsWith("pom.xml")));
    const readDirectory = vi.fn(() => Promise.resolve([]));
    return { scanner: { exists, readDirectory }, exists, readDirectory };
}
