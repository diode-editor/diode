import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";

import type { IWorkspace } from "./iWorkspaceContextService.ts";
import { workspaceLabel } from "./workspaceLabel.ts";

describe("workspaceLabel", () => {
    const folder: IWorkspace = { id: "x", folders: [{ uri: Uri.file("/p/my-App"), name: "my-App", index: 0 }] };

    it("an empty window has no label", () => {
        expect(workspaceLabel({ id: null, folders: [] })).toBe("");
    });

    it("a folder window is the folder name as is", () => {
        expect(workspaceLabel(folder)).toBe("my-App");
    });

    it("a .code-workspace window is the file name without the extension, marked (Workspace)", () => {
        expect(workspaceLabel({ ...folder, configuration: Uri.file("/p/web.code-workspace") })).toBe("web (Workspace)");
    });
});
