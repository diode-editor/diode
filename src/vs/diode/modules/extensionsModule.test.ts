import { afterEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { REGISTRY_SCHEMA_VERSION } from "../../platform/extensionManagement/common/registryFormat.ts";
import type { LogEntry } from "../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { LogService } from "../../platform/log/common/logService.ts";
import { ExtensionPageActionsDIToken } from "../../workbench/contrib/extensions/browser/extensionPageActions.ts";
import {
    ExtensionsComponentDIToken,
    ExtensionsEditorTargetDIToken,
} from "../../workbench/contrib/extensions/browser/extensionsComponent.ts";
import {
    ExtensionVersionContribution,
    ExtensionVersionContributionDIToken,
    INSTALL_ANOTHER_VERSION_COMMAND_ID,
} from "../../workbench/contrib/extensions/browser/extensionVersionActions.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../../workbench/contrib/extensions/common/extensionsWorkbench.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/common/editorService.ts";

import { extensionsModule } from "./extensionsModule.ts";
import { createTestContainer } from "./testProfile.ts";

/** A swapped argument yields a working container with the wrong extension list. */

const HOST = { diode: "1.0.0", vscode: "1.90.0" };

function indexJson(entries: unknown[]): string {
    return JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, extensions: entries });
}

function entry(id: string, engines: Record<string, string>): unknown {
    const [publisher, name] = id.split(".");
    return {
        id,
        publisher,
        name,
        displayName: name,
        description: "",
        kind: "native",
        latest: { version: "1.0.0", engines },
    };
}

describe("extensionsModule", () => {
    let ws: ITempWorkspace | undefined;

    afterEach(() => {
        ws?.dispose();
        ws = undefined;
    });

    /** Marketplace tokens are poisoned: if the production module stopped overriding them, the test would pass on profile defaults. */
    function setup(options: { problems?: string[] } = {}): ReturnType<typeof createTestContainer>["container"] {
        const { container } = createTestContainer({
            environment: { registry: ws!.path("registry"), extensionsDir: ws!.path("extensions") },
        });
        const poison = (what: string) => (): never => {
            throw new Error(`${what} is not overridden by the production marketplace module`);
        };
        container.bind(ExtensionsWorkbenchServiceDIToken, poison("marketplace service"));
        container.bind(ExtensionsComponentDIToken, poison("marketplace viewlet"));
        container.bind(ExtensionsEditorTargetDIToken, poison("page-open seam"));
        container.bind(ExtensionPageActionsDIToken, poison("page actions"));
        container.use(extensionsModule, {
            host: HOST,
            onProblem: (message) => options.problems?.push(message),
        });
        return container;
    }

    it("service reads the registry at the given address and the active profile's contents", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-module-" });
        ws.writeFile(
            "registry/index.json",
            indexJson([entry("acme.tools", { vscode: "^1.0.0" }), entry("old.legacy", { vscode: "^99.0.0" })]),
        );
        ws.writeFile(
            "extensions/local.helper-0.1.0/package.json",
            JSON.stringify({ publisher: "local", name: "helper", version: "0.1.0" }),
        );
        // On disk but not in the window's profile (Default: `extensions/extensions.json`) — not visible.
        ws.writeFile(
            "extensions/local.other-0.1.0/package.json",
            JSON.stringify({ publisher: "local", name: "other", version: "0.1.0" }),
        );
        ws.writeFile(
            "extensions/extensions.json",
            JSON.stringify([{ identifier: { id: "local.helper" }, version: "0.1.0" }]),
        );

        const service = setup().get(ExtensionsWorkbenchServiceDIToken);
        await service.ensureLoaded();

        expect(service.getEntries().map((e) => `${e.id}:${e.availability}`)).toEqual([
            // Compatibility is computed against build versions from the same binding.
            "acme.tools:available",
            "old.legacy:incompatible",
            "local.helper:installed",
        ]);
    });

    it("unreadable profile contents — empty list and an error in the Extensions channel", () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-module-" });
        ws.writeFile(
            "extensions/local.helper-0.1.0/package.json",
            JSON.stringify({ publisher: "local", name: "helper", version: "0.1.0" }),
        );
        ws.writeFile("extensions/extensions.json", "{");
        const entries: LogEntry[] = [];
        const logService = new LogService();
        logService.addSink({ append: (entry) => entries.push(entry), dispose: () => undefined });
        const container = setup();
        container.bind(ILogServiceDIToken, () => logService);

        expect(container.get(ExtensionsWorkbenchServiceDIToken).getEntries()).toEqual([]);
        expect(entries.map((e) => [e.channel, e.message])).toEqual([
            ["extensions", `Failed to read profile extensions ${ws.path("extensions/extensions.json")}`],
        ]);
        expect(logService.getRegisteredChannels()).toContainEqual({ id: "extensions", label: "Extensions" });
    });

    it("parser diagnostics go to the given onProblem", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-module-" });
        ws.writeFile("registry/index.json", indexJson([entry("acme.tools", { vscode: "^1.0.0" }), { id: "broken" }]));
        const problems: string[] = [];

        await setup({ problems }).get(ExtensionsWorkbenchServiceDIToken).ensureLoaded();

        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("skipping invalid entry");
    });

    it("the editor strip opens the extension page", () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-module-" });
        const container = setup();

        expect(container.get(ExtensionsEditorTargetDIToken)).toBe(container.get(EditorServiceDIToken));
    });

    it("the viewlet is built from the container", () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-module-" });

        expect(setup().get(ExtensionsComponentDIToken).view.id).toBe("extensionsView");
    });

    it("page actions use the same marketplace as the viewlet", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-module-" });
        ws.writeFile("registry/index.json", indexJson([]));
        const container = setup();

        // Nothing to uninstall — what matters is that the answer comes from the real service over
        // the given directory, not from a stub.
        await expect(container.get(ExtensionPageActionsDIToken).uninstall("acme.tools")).resolves.toEqual({
            ok: false,
            error: "Extension acme.tools is not installed",
        });
    });

    it("the version contribution registers the page command over the same marketplace", () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-module-" });
        const container = setup();

        expect(container.get(ExtensionVersionContributionDIToken)).toBeInstanceOf(ExtensionVersionContribution);
        expect(container.get(CommandRegistryDIToken).has(INSTALL_ANOTHER_VERSION_COMMAND_ID)).toBe(true);
    });
});
