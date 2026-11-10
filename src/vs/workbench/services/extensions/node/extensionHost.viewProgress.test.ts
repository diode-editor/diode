import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import { ProgressService, SPINNER_FRAMES } from "../../../../platform/progress/common/progressService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { ExtensionProgressAdapter } from "../../../api/browser/extensionProgressAdapter.ts";
import { ExtensionViewProgressAdapter } from "../../../api/browser/extensionViewProgressAdapter.ts";
import { ProgressStatusBarAdapter } from "../../../api/browser/progressStatusBarAdapter.ts";
import { registerExtensionViews } from "../../../api/browser/viewsExtensionPoint.ts";
import { ViewProgressContribution } from "../../../browser/parts/views/viewProgressContribution.ts";
import { makeViewsHarness, testView } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { NotificationService } from "../../notification/browser/notificationService.ts";
import { StatusBarService } from "../../statusbar/common/statusBarService.ts";

const CONTAINER = "workbench.view.extension.probe";
const VIEW = "probe.items";
const SCM_VIEW = "workbench.scm.changes";

// The real subprocess: `withProgress` in a view reaches its header as the spinner, and only the spinner.
describe("ExtensionHost — withProgress in a view", () => {
    let harness: IExtensionHarness | undefined;
    let progress: ProgressService | undefined;

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
        progress?.dispose();
        progress = undefined;
    });

    async function setup() {
        const views = makeViewsHarness();
        const extension: IExtension = {
            id: "test.viewProgress",
            manifest: {
                name: "viewProgress",
                publisher: "test",
                version: "0.0.1",
                engines: { vscode: "^1.0.0" },
                contributes: {
                    viewsContainers: { activitybar: [{ id: "probe", title: "Probe", icon: "x" }] },
                    views: {
                        probe: [
                            { id: VIEW, name: "Items" },
                            { id: "probe.other", name: "Other" },
                        ],
                    },
                },
            },
            location: "UserExtensions/viewProgress/",
            isBuiltin: false,
        };
        const errors: string[] = [];
        const logger = {
            warn: () => undefined,
            error: (line: string) => errors.push(line),
        } as unknown as ILogger;
        registerExtensionViews([extension], {
            views: views.service,
            commands: views.commands,
            contextKeys: views.contextKeys,
            notify: () => undefined,
            logger,
        });
        views.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        views.service.registerView(testView(SCM_VIEW, "scm", 10));
        views.service.registerView(testView("workbench.scm.graph", "scm", 20));
        views.service.attachRegisteredContainers();
        views.showViewlet(CONTAINER);

        progress = new ProgressService({ delayMs: 0, minVisibleMs: 0, intervalMs: 50 });
        new ViewProgressContribution(progress, views.service);
        const statusBar = new StatusBarService(NULL_STATE_SERVICE);
        const notifications = new NotificationService();
        harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.viewProgress", "showsViewProgress.cjs")],
            progressSink: new ExtensionProgressAdapter(
                new ProgressStatusBarAdapter(statusBar),
                notifications,
                new ExtensionViewProgressAdapter(views.service, progress, logger, SCM_VIEW),
            ),
        });
        const app = TestApp.createWithContent(views.root(CONTAINER), new Size(40, 12));
        const frame = (): string => {
            app.render();
            return app.backend.screenToString();
        };
        const spinning = (): boolean => SPINNER_FRAMES.some((glyph) => frame().includes(glyph));
        return { ext: harness, views, frame, spinning, errors, statusBar, notifications, progress };
    }

    it("[api:window.withProgress] `{ viewId }` of a contributed view: a spinner on its header while the task runs, gone after", async () => {
        const { ext, frame, spinning, statusBar, notifications } = await setup();
        expect(spinning()).toBe(false);

        await ext.commandRegistry.execute("test.viewProgress.start", "a", VIEW);
        await waitUntil("the spinner in the header", spinning);
        const header = frame()
            .split("\n")
            .find((line) => SPINNER_FRAMES.some((glyph) => line.includes(glyph)));
        expect(header).toContain("ITEMS");
        // Only the indicator: no message, percent or Cancel anywhere, no status bar entry, no toast.
        expect(frame()).not.toContain("half");
        expect(frame()).not.toContain("50%");
        expect(frame()).not.toContain("Cancel");
        expect(statusBar.entries()).toEqual([]);
        expect(notifications.passive()).toEqual([]);

        await expect(ext.commandRegistry.execute("test.viewProgress.finish", "a")).resolves.toBe("done a");
        await waitUntil("the spinner gone", () => !spinning());
    });

    it("[api:window.withProgress] a container id spins its first view; SourceControl spins the SCM view and leaves it not busy", async () => {
        const { ext, views, progress: service } = await setup();
        const spinnerOf = (viewId: string): boolean => service.viewProgress().has(viewId);

        await ext.commandRegistry.execute("test.viewProgress.start", "c", CONTAINER);
        await waitUntil("the container's first view", () => spinnerOf(VIEW));
        expect(spinnerOf("probe.other")).toBe(false);

        views.showViewlet("scm");
        await ext.commandRegistry.execute("test.viewProgress.start", "s", "sourceControl");
        await waitUntil("the SCM view", () => spinnerOf(SCM_VIEW));
        // An extension's progress doesn't disable git commands.
        expect(service.isBusy(SCM_VIEW)).toBe(false);

        await ext.commandRegistry.execute("test.viewProgress.finish", "c");
        await ext.commandRegistry.execute("test.viewProgress.finish", "s");
        await waitUntil("both spinners gone", () => service.viewProgress().size === 0);
    });

    it("[api:window.withProgress] an unknown id: no UI, a line in the log, the task still resolves", async () => {
        const { ext, spinning, errors, statusBar, progress: service } = await setup();

        await ext.commandRegistry.execute("test.viewProgress.start", "u", "no.such.view");
        await waitUntil("the log line", () => errors.length > 0);
        expect(errors).toEqual(["Bad progress location: no.such.view"]);
        expect(spinning()).toBe(false);
        expect(service.viewProgress().size).toBe(0);
        expect(statusBar.entries()).toEqual([]);

        await expect(ext.commandRegistry.execute("test.viewProgress.finish", "u")).resolves.toBe("done u");
    });
});
