import { afterEach, describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import {
    createDefaultProfile,
    toUserDataProfile,
} from "../../../../platform/userDataProfile/common/userDataProfile.ts";
import type { IWorkspace } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";

import { APP_NAME, windowTitle, WindowTitleContribution } from "./windowTitleContribution.ts";

const defaultProfile = createDefaultProfile("/u/User");
const work = toUserDataProfile("work", "Work", "/u/User/profiles/work");

describe("windowTitle", () => {
    const empty: IWorkspace = { id: null, folders: [] };
    const folder: IWorkspace = { id: "x", folders: [{ uri: Uri.file("/p/app"), name: "app", index: 0 }] };

    it("empty window in Default — just the app name", () => {
        expect(windowTitle(empty, defaultProfile)).toBe(APP_NAME);
    });

    it("folder and a named profile — with the upstream separator; Default has no profile in the title", () => {
        expect(windowTitle(folder, work)).toBe("app - Work - Diode");
        expect(windowTitle(folder, defaultProfile)).toBe("app - Diode");
        expect(windowTitle(empty, work)).toBe("Work - Diode");
    });

    it("a .code-workspace window is named after the file, like workspace.name for extensions", () => {
        const fromFile: IWorkspace = { ...folder, configuration: Uri.file("/p/web.code-workspace") };
        expect(windowTitle(fromFile, work)).toBe("web (Workspace) - Work - Diode");
    });
});

describe("WindowTitleContribution", () => {
    let contribution: WindowTitleContribution | undefined;

    afterEach(() => {
        contribution?.dispose();
    });

    it("sets the title on startup and on workspace change; not after dispose", () => {
        const titles: string[] = [];
        const workspaceContext = new WorkspaceContextService();
        contribution = new WindowTitleContribution(workspaceContext, { currentProfile: work }, (title) =>
            titles.push(title),
        );
        expect(titles).toEqual(["Work - Diode"]);

        workspaceContext.setWorkspaceFolder("/p/app");
        expect(titles).toEqual(["Work - Diode", "app - Work - Diode"]);

        contribution.dispose();
        contribution = undefined;
        workspaceContext.setWorkspaceFolder("/p/other");
        expect(titles).toHaveLength(2);
    });
});
