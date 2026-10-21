import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";

import type { IWorkspaceScanner } from "./workspaceContainsActivation.ts";

/**
 * Fixtures are real files in the harness `tmpDir` (its workspace folder);
 * the walk semantics are in the scanner's unit tests.
 */
describe("ExtensionHost — activation by workspaceContains:", () => {
    it("a path pattern matches a file in a workspace folder → the extension is active", async () => {
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

    it("a glob pattern matches at the first tree level", async () => {
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

    it("no pattern matches → the extension stays inactive, the subprocess is not started", async () => {
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

    it("evaluated PER EXTENSION: a matched pattern activates only its owner", async () => {
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

    it("idempotent: a second pass does not reactivate or read the FS again", async () => {
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
            expect(scanner.exists.mock.calls.length).toBe(callsAfterFirst);
        } finally {
            await harness.dispose();
        }
    });

    it("LAZINESS: a file appears later and a repeated pass activates the extension", async () => {
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

    it("without candidates the FS is not touched at all", async () => {
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

    it("scanner throws: sibling activation is not derailed", async () => {
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

    it("a non-file: workspace folder is skipped: our scanner cannot walk it", async () => {
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

    it("a `file:` folder reaches the scanner as a real path, not a uri string", async () => {
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

function spyScanner(): {
    scanner: IWorkspaceScanner;
    exists: ReturnType<typeof vi.fn>;
    readDirectory: ReturnType<typeof vi.fn>;
} {
    const exists = vi.fn((absolutePath: string) => Promise.resolve(absolutePath.endsWith("pom.xml")));
    const readDirectory = vi.fn(() => Promise.resolve([]));
    return { scanner: { exists, readDirectory }, exists, readDirectory };
}
