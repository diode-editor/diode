import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { quickPickByTitle } from "../../../../../TestUtils/domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { NERD_FONT_SETTING, ProductIconServiceDIToken } from "../../../../platform/theme/common/productIconService.ts";
import { ExtensionLanguageStatusAdapter } from "../../../api/browser/extensionLanguageStatusAdapter.ts";
import type { IWireLanguageStatusItem } from "../../../api/common/wireTypes.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { LanguageStatusServiceDIToken } from "../../../services/languageStatus/common/languageStatusService.ts";
import { StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

import {
    LANGUAGE_STATUS_ID,
    LANGUAGE_STATUS_NAME,
    LanguageStatusContribution,
    languageStatusGlyph,
} from "./languageStatus.ts";

const NERD = { bracket: "", bracketDot: "", bracketError: "", loading: "" };
const UNICODE = { bracket: "{", bracketDot: "⁅", bracketError: "‼", loading: "◌" };
const PUA = /[-]/u;

function wireItem(handle: number, overrides: Partial<IWireLanguageStatusItem> = {}): IWireLanguageStatusItem {
    return {
        handle,
        id: `test.ext/item-${String(handle)}`,
        source: "test.ext",
        selector: [{ language: "plaintext" }],
        text: `Item ${String(handle)}`,
        severity: 0,
        busy: false,
        ...overrides,
    };
}

describe("LanguageStatusContribution — the segment on the frame", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let sink: ExtensionLanguageStatusAdapter;
    let runs: unknown[][];

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-langstatus-",
            files: { "notes.txt": "hello\n", "main.md": "# x\n" },
        });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: `${ws.dir}/notes.txt`,
            focusEditor: true,
            size: new Size(100, 24),
        });
        await h.workbench.activate();
        await h.container.get(IConfigurationServiceDIToken).updateValue(NERD_FONT_SETTING, "on");
        sink = new ExtensionLanguageStatusAdapter(h.container.get(LanguageStatusServiceDIToken));
        runs = [];
        h.commands.register("test.ext.run", (...args: unknown[]) => {
            runs.push(args);
        });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function statusRow(): string {
        h.testApp.render();
        const lines = h.testApp.backend.screenToString().split("\n");
        return lines[lines.length - 1] ?? "";
    }

    /** Mouse tokens are 1-based, as the terminal reports them. */
    function clickOnRow(x: number): void {
        const y = h.testApp.backend.screenToString().split("\n").length;
        for (const action of ["press", "release"] as const) {
            h.testApp.backend.simulateMouse({
                kind: "mouse",
                button: "left",
                action,
                x: x + 1,
                y,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            });
        }
        h.testApp.render();
    }

    it("no matching item, no segment; a matching one shows between EOL and the language", () => {
        expect(statusRow()).not.toContain(NERD.bracket);

        sink.update(wireItem(1, { selector: [{ language: "markdown" }] }));
        expect(statusRow()).not.toContain(NERD.bracket);

        sink.update(wireItem(2));
        expect(statusRow()).toMatch(new RegExp(`LF +${NERD.bracket} +plaintext`, "u"));
    });

    it("the glyph follows the highest severity; any busy item turns it into the spinner", () => {
        sink.update(wireItem(1));
        sink.update(wireItem(2, { severity: 1 }));
        expect(statusRow()).toContain(NERD.bracketDot);

        sink.update(wireItem(3, { severity: 2 }));
        expect(statusRow()).toContain(NERD.bracketError);

        sink.update(wireItem(1, { busy: true }));
        const row = statusRow();
        expect(row).toContain(NERD.loading);
        expect(row).not.toContain(NERD.bracketError);
    });

    it("the last removal takes the segment away; a host crash (`clear`) does too", () => {
        sink.update(wireItem(1));
        sink.update(wireItem(2));
        sink.remove(1);
        expect(statusRow()).toContain(NERD.bracket);
        sink.remove(2);
        expect(statusRow()).not.toContain(NERD.bracket);

        sink.update(wireItem(3));
        expect(statusRow()).toContain(NERD.bracket);
        sink.clear();
        expect(statusRow()).not.toContain(NERD.bracket);
    });

    it("switching to a non-matching editor hides it, changing the language re-matches", async () => {
        sink.update(wireItem(1, { selector: [{ language: "markdown" }] }));
        expect(statusRow()).not.toContain(NERD.bracket);

        h.activeEditor().setLanguage("markdown");
        expect(statusRow()).toContain(NERD.bracket);

        // The test container detects no languages: main.md opens as plaintext.
        h.workbench.openFile(`${ws.dir}/main.md`);
        await Promise.resolve();
        expect(statusRow()).not.toContain(NERD.bracket);
        h.activeEditor().setLanguage("markdown");
        expect(statusRow()).toContain(NERD.bracket);
    });

    it("a click opens the item list; choosing an item runs its command with its arguments", async () => {
        sink.update(wireItem(1, { text: "$(check) Ruff", detail: "Native server" }));
        sink.update(
            wireItem(2, {
                severity: 1,
                source: "a.ext",
                text: "Pyright",
                command: { command: "test.ext.run", title: "Restart", arguments: [7, "x"] },
            }),
        );
        const row = statusRow();
        clickOnRow(row.indexOf(NERD.bracketDot));

        const picker = quickPickByTitle(h.testApp, LANGUAGE_STATUS_NAME);
        const screen = h.testApp.backend.screenToString();
        // Severity first: the warning goes above the information.
        expect(screen.indexOf("Pyright")).toBeLessThan(screen.indexOf("Ruff"));
        expect(screen).toContain("Restart");
        expect(screen).toContain("Native server");
        expect(picker.title).toBe(LANGUAGE_STATUS_NAME);

        h.testApp.sendKey("Enter");
        await flushMicrotasks();
        expect(runs).toStrictEqual([[7, "x"]]);
    });

    it("an item without a command just closes the list; a throwing command leaves the segment usable", async () => {
        h.commands.register("test.ext.throw", () => {
            throw new Error("boom");
        });
        sink.update(wireItem(1, { text: "Plain" }));
        clickOnRow(statusRow().indexOf(NERD.bracket));
        expect(h.testApp.backend.screenToString()).toContain("Plain");
        h.testApp.sendKey("Enter");
        await flushMicrotasks();
        expect(statusRow()).toContain(NERD.bracket);
        expect(h.testApp.backend.screenToString()).not.toContain("Plain");
        expect(runs).toStrictEqual([]);

        sink.update(wireItem(1, { text: "Plain", command: { command: "test.ext.throw", title: "Throw" } }));
        clickOnRow(statusRow().indexOf(NERD.bracket));
        h.testApp.sendKey("Enter");
        await flushMicrotasks();

        sink.update(wireItem(1, { text: "Plain", command: { command: "test.ext.run", title: "Run" } }));
        clickOnRow(statusRow().indexOf(NERD.bracket));
        h.testApp.sendKey("Enter");
        await flushMicrotasks();
        expect(runs).toStrictEqual([[]]);
    });

    it("closing the last editor takes the segment away", async () => {
        sink.update(wireItem(1));
        expect(statusRow()).toContain(NERD.bracket);
        await h.commands.execute("workbench.action.closeAllEditors");
        await flushMicrotasks();
        expect(h.container.get(EditorServiceDIToken).getActiveEditor()).toBeNull();
        expect(statusRow()).not.toContain(NERD.bracket);
    });

    it("Escape closes the list without running anything", async () => {
        sink.update(wireItem(1, { command: { command: "test.ext.run", title: "Run" } }));
        clickOnRow(statusRow().indexOf(NERD.bracket));
        expect(h.testApp.backend.screenToString()).toContain(LANGUAGE_STATUS_NAME);
        h.testApp.sendKey("Escape");
        await flushMicrotasks();
        expect(h.testApp.backend.screenToString()).not.toContain(LANGUAGE_STATUS_NAME);
        expect(runs).toStrictEqual([]);
    });

    it("created with an editor already active it shows at once; after dispose nothing brings it back", () => {
        sink.update(wireItem(1, { selector: [{ language: "markdown" }] }));
        const bar = new StatusBarService(NULL_STATE_SERVICE);
        const contribution = new LanguageStatusContribution(
            h.container.get(EditorServiceDIToken),
            bar,
            h.container.get(LanguageStatusServiceDIToken),
            h.container.get(QuickInputServiceDIToken),
            h.commands,
            h.container.get(ProductIconServiceDIToken),
        );
        const ids = (): string[] => bar.entries().map((e) => e.id);
        expect(ids()).toEqual([]);
        h.activeEditor().setLanguage("markdown");
        expect(ids()).toEqual([LANGUAGE_STATUS_ID]);

        contribution.dispose();
        expect(ids()).toEqual([]);
        // Neither the language nor an item change reaches a disposed contribution.
        h.activeEditor().setLanguage("plaintext");
        h.activeEditor().setLanguage("markdown");
        sink.update(wireItem(2, { selector: [{ language: "markdown" }] }));
        expect(ids()).toEqual([]);
    });

    it("created with a matching editor already active it shows without any event", () => {
        sink.update(wireItem(1));
        const bar = new StatusBarService(NULL_STATE_SERVICE);
        const contribution = new LanguageStatusContribution(
            h.container.get(EditorServiceDIToken),
            bar,
            h.container.get(LanguageStatusServiceDIToken),
            h.container.get(QuickInputServiceDIToken),
            h.commands,
            h.container.get(ProductIconServiceDIToken),
        );
        expect(bar.entries().map((e) => e.id)).toEqual([LANGUAGE_STATUS_ID]);
        contribution.dispose();
    });

    it("diode.icons.nerdFont: off draws the Unicode glyph, the frame has no Private Use Area characters", async () => {
        sink.update(wireItem(1, { severity: 2 }));
        expect(statusRow()).toContain(NERD.bracketError);

        await h.container.get(IConfigurationServiceDIToken).updateValue(NERD_FONT_SETTING, "off");
        const row = statusRow();
        expect(row).toContain(UNICODE.bracketError);
        expect(row).not.toMatch(PUA);
    });

    it("the segment is in the visibility menu as Editor Language Status", () => {
        sink.update(wireItem(1));
        statusRow();
        const entry = h.container
            .get(StatusBarServiceDIToken)
            .entries()
            .find((e) => e.id === LANGUAGE_STATUS_ID);
        expect(entry?.name).toBe(LANGUAGE_STATUS_NAME);
    });
});

describe("languageStatusGlyph", () => {
    const status = (severity: 0 | 1 | 2, busy = false) => ({
        id: "x",
        name: undefined,
        selector: "*",
        severity,
        label: "",
        detail: "",
        busy,
        source: "",
        command: undefined,
    });

    it("maps the first item's severity, busy wins", () => {
        expect(languageStatusGlyph([status(0)])).toBe("$(bracket)");
        expect(languageStatusGlyph([status(1), status(0)])).toBe("$(bracket-dot)");
        expect(languageStatusGlyph([status(2)])).toBe("$(bracket-error)");
        expect(languageStatusGlyph([status(2), status(0, true)])).toBe("$(loading~spin)");
        expect(languageStatusGlyph([])).toBe("$(bracket)");
    });
});
