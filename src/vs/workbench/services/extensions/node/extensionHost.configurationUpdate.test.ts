import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
    manifestWithDefaults,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { loadConfiguration } from "../../../../platform/configuration/node/configurationService.ts";
import { resolveUserDataPaths } from "../../../../platform/environment/node/userDataPaths.ts";

const ID = "test.updatesConfiguration";
const DEFAULTS = { "test.update.open": true, "test.update.notification": true };

interface IUpdateResult {
    readonly value?: unknown;
    readonly globalValue?: unknown;
    readonly workspaceValue?: unknown;
    readonly changes?: readonly boolean[];
    readonly error?: string;
}

/**
 * Сквозняк `WorkspaceConfiguration.update`: синтетическое расширение в
 * настоящем субпроцессе пишет через хост в ФАЙЛОВЫЙ сервис настроек — тот же,
 * что у приложения, — и видит результат в `get()`, `inspect()` и
 * `onDidChangeConfiguration`, а файл ложится на диск.
 */
describe("ExtensionHost — WorkspaceConfiguration.update (subprocess → settings.json)", () => {
    let userData: ITempWorkspace;
    let folder: ITempWorkspace;

    beforeEach(() => {
        userData = createTempWorkspace({ prefix: "diode-ext-cfg-user-" });
        folder = createTempWorkspace({ prefix: "diode-ext-cfg-ws-" });
    });

    afterEach(() => {
        userData.dispose();
        folder.dispose();
    });

    async function withHarness(
        options: { readonly withFolder: boolean },
        run: (harness: IExtensionHarness) => Promise<void>,
    ): Promise<void> {
        // Реестр — как в main.ts: настройки расширения из его манифеста.
        const registry = new ConfigurationRegistry();
        registry.registerExtensionConfiguration(ID, {
            "test.update.open": { default: true },
            "test.update.notification": { default: true },
        });
        const service = await loadConfiguration(
            userPaths(),
            undefined,
            undefined,
            registry,
            options.withFolder ? folder.dir : undefined,
        );
        const fixture = extensionFixture(ID, "updatesConfiguration.cjs");
        const harness = await createExtensionTestHarness({
            extensions: [{ ...fixture, manifest: manifestWithDefaults(fixture.manifest, DEFAULTS) }],
            workspaceFolders: options.withFolder ? [folder.dir] : [],
            extensionConfigurationService: service,
        });
        try {
            await run(harness);
        } finally {
            await harness.dispose();
            service.dispose();
        }
    }

    function update(harness: IExtensionHarness, ...args: unknown[]): Promise<IUpdateResult> {
        return harness.commandRegistry.execute("test.config.update", ...args) as Promise<IUpdateResult>;
    }

    function userPaths() {
        return resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir });
    }

    function readJson(file: string): unknown {
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    }

    it("без цели — в .diode/settings.json папки; после await get() уже видит значение", async () => {
        await withHarness({ withFolder: true }, async (harness) => {
            // Как Bazel-плагин: `getConfiguration("bazel.projectview").update("open", false)`.
            const result = await update(harness, "test.update", "open", false, null);
            expect(result).toEqual({ value: false, globalValue: null, workspaceValue: false, changes: [true] });
            expect(readJson(path.join(folder.dir, ".diode", "settings.json"))).toEqual({ "test.update.open": false });
            expect(fs.existsSync(userPaths().settingsFile)).toBe(false);
        });
    });

    it("ConfigurationTarget.Global — в User/settings.json; undefined снимает ключ", async () => {
        await withHarness({ withFolder: true }, async (harness) => {
            const written = await update(harness, "test.update", "notification", false, 1);
            expect(written).toEqual({ value: false, globalValue: false, workspaceValue: null, changes: [false] });
            const userSettings = userPaths().settingsFile;
            expect(readJson(userSettings)).toEqual({ "test.update.notification": false });

            const removed = await update(harness, "test.update", "notification", null, true);
            expect(removed).toEqual({ value: true, globalValue: null, workspaceValue: null, changes: [false] });
            expect(readJson(userSettings)).toEqual({});
        });
    });

    it("незарегистрированный ключ — отказ текстом эталона, файла нет", async () => {
        await withHarness({ withFolder: true }, async (harness) => {
            expect(await update(harness, "test.update", "unknown", 1, null)).toEqual({
                error: "Unable to write to Workspace Settings because test.update.unknown is not a registered configuration.",
            });
            expect(fs.existsSync(path.join(folder.dir, ".diode"))).toBe(false);
        });
    });

    it("окно без папки: без цели — отказ «no workspace is opened», Global — пишет", async () => {
        await withHarness({ withFolder: false }, async (harness) => {
            expect(await update(harness, "test.update", "open", false, null)).toEqual({
                error: "Unable to write to Workspace Settings because no workspace is opened. Please open a workspace first and try again.",
            });
            expect(await update(harness, "test.update", "open", false, true)).toMatchObject({
                value: false,
                globalValue: false,
            });
        });
    });
});
