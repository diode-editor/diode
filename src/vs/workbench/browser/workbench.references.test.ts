import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { afterEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { Uri } from "../../base/common/uri.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import { createRange } from "../../editor/common/core/iRange.ts";
import type { ICoreReference, IReferenceRequest } from "../../editor/common/languages/iReferenceSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

import { WorkbenchComponentDIToken } from "./workbenchComponent.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

/**
 * Setup lives in the test body, not in `beforeEach`: coverage (mutation coverage included)
 * is attributed to the body, and wiring set up in a hook would belong to no test.
 */

const FIND_REFERENCES = "references-view.findReferences";
const NEXT_REFERENCE = "references-view.next";
const SHOW_REFERENCES = "workbench.view.references";
const SHOW_EXPLORER = "workbench.view.explorer";

const MAIN_TS = 'import { greet } from "./defs";\n\nconst hello = greet("world");\n';
const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';

interface IHarness {
    readonly execute: (command: string) => void;
    readonly screen: () => string;
    readonly referenceList: () => ListViewElement;
    readonly contextKey: (key: "referencesViewletVisible" | "hasReferenceResult") => boolean | undefined;
    readonly activeUri: () => string | undefined;
    readonly caret: () => { line: number; character: number } | undefined;
    readonly requests: IReferenceRequest[];
    readonly focusedId: () => string | undefined;
    readonly viewRoot: () => unknown;
    readonly awaitResults: () => Promise<void>;
}

describe("Workbench — Find All References end-to-end", () => {
    let ws: ITempWorkspace | undefined;

    afterEach(() => {
        ws?.dispose();
        ws = undefined;
    });

    function setup(): IHarness {
        ws = createTempWorkspace({
            prefix: "diode-references-",
            files: { "main.ts": MAIN_TS, "defs.ts": DEFS_TS },
        });
        const workspace = ws;

        const { container, bindApp } = createTestContainer();
        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const contextKeys = container.get(ContextKeyServiceDIToken);
        const workbenchContextKeys = container.get(WorkbenchContextKeysDIToken);
        const editors = container.get(EditorServiceDIToken);

        // Declaration in defs.ts, import and call in main.ts.
        const requests: IReferenceRequest[] = [];
        container.get(LanguageFeaturesServiceDIToken).referenceProvider.register("*", {
            provideReferences: (request): Promise<readonly ICoreReference[]> => {
                requests.push(request);
                return Promise.resolve([
                    { uri: Uri.file(workspace.path("defs.ts")).toString(), range: createRange(0, 16, 0, 21) },
                    { uri: Uri.file(workspace.path("main.ts")).toString(), range: createRange(0, 9, 0, 14) },
                    { uri: Uri.file(workspace.path("main.ts")).toString(), range: createRange(2, 14, 2, 19) },
                ]);
            },
        });

        workbench.setWorkspaceFolder(workspace.dir);
        workbench.mount();
        const testApp = TestApp.create(workbench.view, new Size(120, 24));
        bindApp(testApp.app);

        // Cursor on the `greet` call in main.ts.
        editors.openFile(workspace.path("main.ts"));
        editors.getActiveEditor()!.goToPosition(2, 15);

        return {
            execute: (command) => {
                commands.execute(command);
                workbenchContextKeys.update();
            },
            screen: () => {
                testApp.render();
                return testApp.backend.screenToString();
            },
            referenceList: () => {
                const list = workbench.view.querySelector("#referenceResults");
                expect(list, "references list not found in the tree").not.toBeNull();
                return list as ListViewElement;
            },
            contextKey: (key) => contextKeys.get(key),
            activeUri: () => editors.getActivePane()?.uri.toString(),
            caret: () => {
                const active = editors.getActiveEditor();
                return active === null ? undefined : active.viewState.selections[0].active;
            },
            requests,
            focusedId: () => testApp.focusedElement?.id,
            viewRoot: () => workbench.view.querySelector("#referencesView"),
            awaitResults: async () => {
                for (let i = 0; i < 100 && contextKeys.get("hasReferenceResult") !== true; i++) {
                    await settle(1);
                    workbenchContextKeys.update();
                }
            },
        };
    }

    it("the command queries providers at the cursor and shows the references in the sidebar", async () => {
        const h = setup();
        expect(h.screen()).toContain("EXPLORER");

        h.execute(FIND_REFERENCES);
        await h.awaitResults();

        expect(h.requests).toHaveLength(1);
        expect(h.requests[0]).toMatchObject({ line: 2, character: 15, includeDeclaration: true });

        const shown = h.screen();
        expect(shown).toContain("REFERENCES");
        expect(shown).toContain("3 results in 2 files");
        expect(shown).toContain("defs.ts");
        expect(shown).toContain("main.ts");
        // Code lines are read from disk — they are not in the main.ts buffer.
        expect(shown).toContain("export function greet(");
        expect(shown).not.toContain("EXPLORER");
        expect(h.contextKey("referencesViewletVisible")).toBe(true);
        expect(h.contextKey("hasReferenceResult")).toBe(true);
        expect(h.focusedId()).toBe("referenceResults");
        expect(h.viewRoot()).not.toBeNull();
    });

    it("the viewlet is available from the View menu before the first search, as an empty panel", () => {
        const h = setup();

        h.execute(SHOW_REFERENCES);

        const shown = h.screen();
        expect(shown).toContain("REFERENCES");
        expect(shown).not.toContain("EXPLORER");
        expect(shown).not.toContain("results in");
        expect(h.contextKey("hasReferenceResult")).toBe(false);
    });

    it("Enter on a reference opens its file at the position", async () => {
        const h = setup();
        h.execute(FIND_REFERENCES);
        await h.awaitResults();

        const list = h.referenceList();
        list.setCursorTo("ref:defs.ts:0");
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
        await settle(0);

        expect(h.activeUri()).toBe(Uri.file(ws!.path("defs.ts")).toString());
        expect(h.caret()).toEqual({ line: 0, character: 16 });
    });

    it("F4 goes to the next reference without moving focus to the panel", async () => {
        const h = setup();
        h.execute(FIND_REFERENCES);
        await h.awaitResults();

        // The panel's cursor is on the first reference (defs.ts) — F4 goes to the second.
        h.execute(NEXT_REFERENCE);
        await settle(0);

        expect(h.activeUri()).toBe(Uri.file(ws!.path("main.ts")).toString());
        expect(h.caret()).toEqual({ line: 0, character: 9 });
    });

    it("switching to Explorer and back keeps the result", async () => {
        const h = setup();
        h.execute(FIND_REFERENCES);
        await h.awaitResults();

        h.execute(SHOW_EXPLORER);
        expect(h.screen()).toContain("EXPLORER");
        expect(h.contextKey("referencesViewletVisible")).toBe(false);
        expect(h.contextKey("hasReferenceResult")).toBe(true);

        h.execute(SHOW_REFERENCES);
        const shown = h.screen();
        expect(shown).toContain("3 results in 2 files");
        expect(shown).toContain("defs.ts");
    });
});
