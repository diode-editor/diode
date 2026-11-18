// The files behind the rows of BREAKPOINTS and LOADED SCRIPTS: the label of a folder relative to the workspace
// (upstream `getUriLabel` with `relative: true`), the lines of a file for the tree presentation (upstream reads the
// text model; here the file on disk, an unsaved change shows after the save), the editor at a breakpoint's line
// (upstream `openBreakpointSource`: the line in the active group, or beside it, as a jump for Go Back) and a loaded
// script's file (upstream `Source.openInEditor`).

import * as nodePath from "node:path";

import type { Uri } from "../../../../base/common/uri.ts";
import { type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { openUriAtPosition } from "../../../services/editor/browser/openUriAtPosition.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";
import { type IJumpRecorder, JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import type { IBreakpoint, IStackFrame } from "../common/debug.ts";

import type { IBreakpointSources } from "./breakpointsView.ts";

export class BreakpointSources implements IBreakpointSources {
    public static dependencies = [
        EditorServiceDIToken,
        JumpRecorderDIToken,
        IFileServiceDIToken,
        IWorkspaceContextServiceDIToken,
    ] as const;

    public constructor(
        private readonly editors: IEditorService,
        private readonly jumps: IJumpRecorder,
        private readonly files: Pick<IFileService, "readFile">,
        private readonly workspace: Pick<IWorkspaceContextService, "getWorkspaceFolder">,
    ) {}

    public uriLabel(uri: Uri): string {
        if (uri.scheme !== "file") return uri.toString();
        const folder = this.workspace.getWorkspaceFolder(uri);
        if (folder === null) return uri.fsPath;
        return nodePath.relative(folder.uri.fsPath, uri.fsPath).split(nodePath.sep).join("/");
    }

    public async readLines(uri: Uri): Promise<readonly string[]> {
        const content = await this.files.readFile(uri);
        return new TextDecoder().decode(content.value).split(/\r?\n/u);
    }

    public openBreakpoint(breakpoint: IBreakpoint, sideBySide: boolean): Promise<void> {
        const position = { line: breakpoint.lineNumber - 1, column: (breakpoint.column ?? 1) - 1 };
        return openUriAtPosition(this.editors, this.jumps, breakpoint.uri, position, { sideBySide });
    }

    public openSource(
        uri: Uri,
        options: { readonly sideBySide: boolean; readonly preserveFocus: boolean },
    ): Promise<void> {
        return openUriAtPosition(this.editors, this.jumps, uri, undefined, {
            sideBySide: options.sideBySide,
            focus: !options.preserveFocus,
        });
    }
}

/**
 * Upstream `StackFrame.openInEditor` (`Source.openInEditor`): the frame's source at its line and column, in the active
 * group or beside it, focused unless `preserveFocus`; a frame without an available source opens nothing. Every open is
 * pinned here. Deviation: no disassembly view.
 */
export async function openStackFrame(
    editors: IEditorService,
    jumps: IJumpRecorder,
    stackFrame: IStackFrame,
    options: { readonly preserveFocus: boolean; readonly sideBySide: boolean },
): Promise<void> {
    if (!stackFrame.source.available) return;
    const position = { line: stackFrame.range.startLineNumber - 1, column: stackFrame.range.startColumn - 1 };
    await openUriAtPosition(editors, jumps, stackFrame.source.uri, position, {
        sideBySide: options.sideBySide,
        focus: !options.preserveFocus,
    });
}
