import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import type { IFileService } from "../../../../platform/files/common/files.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import type { IBreakpoint, IStackFrame } from "../common/debug.ts";

import { BreakpointSources, openStackFrame } from "./breakpointSources.ts";

const FOLDER = Uri.file("/w");
const FILE = Uri.file("/w/src/main.cpp");

interface IFakeEditor {
    readonly uri: Uri;
    readonly goToPosition: ReturnType<typeof vi.fn>;
}

/** An editor service whose `openUri` makes the given file active (or not, when `fails`). */
function fakeEditors(fails = false): {
    editors: IEditorService;
    opened: unknown[][];
    active: () => IFakeEditor | null;
} {
    let active: IFakeEditor | null = null;
    const opened: unknown[][] = [];
    const group = { findPaneIndex: () => -1 };
    const editors = {
        editorGroups: { activeGroup: group, groups: [group] },
        openUri: (uri: Uri, options: unknown) => {
            opened.push([uri.toString(), options]);
            if (!fails) active = { uri, goToPosition: vi.fn() };
            return Promise.resolve();
        },
        getActiveEditor: () => active,
    } as unknown as IEditorService;
    return { editors, opened, active: () => active };
}

const jumps: IJumpRecorder = { jumpAsync: (run) => run() } as IJumpRecorder;

function sources(editors: IEditorService, files: Partial<IFileService> = {}): BreakpointSources {
    return new BreakpointSources(editors, jumps, files as IFileService, {
        getWorkspaceFolder: (uri: Uri) =>
            `${uri.fsPath}/`.startsWith("/w/") ? ({ uri: FOLDER, name: "w", index: 0 } as IWorkspaceFolder) : null,
    });
}

function breakpoint(lineNumber: number, column?: number): IBreakpoint {
    return { uri: FILE, lineNumber, column } as IBreakpoint;
}

describe("BreakpointSources", () => {
    it("labels a folder relative to its workspace folder, absolute outside, whole when not a file", () => {
        const labels = sources(fakeEditors().editors);

        expect(labels.uriLabel(Uri.file("/w/src/lib"))).toBe("src/lib");
        expect(labels.uriLabel(Uri.file("/w"))).toBe("");
        expect(labels.uriLabel(Uri.file("/elsewhere/src"))).toBe("/elsewhere/src");
        expect(labels.uriLabel(Uri.parse("debug:/frame?session=1"))).toBe("debug:/frame?session%3D1");
    });

    it("reads the lines of a file, whatever its line ends", async () => {
        const readFile = vi.fn(() =>
            Promise.resolve({ value: new TextEncoder().encode("int main() {\r\n  return 0;\n}") }),
        );

        const read = await sources(fakeEditors().editors, { readFile } as never).readLines(FILE);

        expect(read).toEqual(["int main() {", "  return 0;", "}"]);
        expect(readFile).toHaveBeenCalledWith(FILE);
    });

    it("opens the breakpoint's line (0-based) in the active group, at its column when it has one", async () => {
        const fake = fakeEditors();

        await sources(fake.editors).openBreakpoint(breakpoint(27, 5), false);

        expect(fake.opened).toEqual([[FILE.toString(), { focus: true }]]);
        expect(fake.active()?.goToPosition).toHaveBeenCalledWith(26, 4);

        await sources(fake.editors).openBreakpoint(breakpoint(3), false);
        expect(fake.active()?.goToPosition).toHaveBeenCalledWith(2, 0);
    });

    it("beside: a new group to the side, the cursor on the line; a file that fails to open moves nothing", async () => {
        const fake = fakeEditors();

        await sources(fake.editors).openBreakpoint(breakpoint(27), true);

        expect(fake.opened).toEqual([[FILE.toString(), { group: "beside", focus: true }]]);
        expect(fake.active()?.goToPosition).toHaveBeenCalledWith(26, 0);

        const failing = fakeEditors(true);
        await sources(failing.editors).openBreakpoint(breakpoint(27), true);
        expect(failing.active()).toBeNull();
    });

    it("a stack frame opens at its line and column, focused unless it keeps the focus; one without a source, never", async () => {
        const { editors, opened, active } = fakeEditors();
        const frame = (available: boolean): IStackFrame =>
            ({ source: { available, uri: FILE }, range: { startLineNumber: 27, startColumn: 9 } }) as IStackFrame;

        await openStackFrame(editors, jumps, frame(false), { preserveFocus: false, sideBySide: false });
        expect(opened).toEqual([]);

        await openStackFrame(editors, jumps, frame(true), { preserveFocus: true, sideBySide: true });
        expect(opened).toEqual([[FILE.toString(), { group: "beside", focus: false }]]);
        expect(active()?.goToPosition).toHaveBeenCalledWith(26, 8);
    });
});
