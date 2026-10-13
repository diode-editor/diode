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

    it("пустое окно в Default — только имя приложения", () => {
        expect(windowTitle(empty, defaultProfile)).toBe(APP_NAME);
    });

    it("папка и именованный профиль — через разделитель эталона; у Default профиля в заголовке нет", () => {
        expect(windowTitle(folder, work)).toBe("app - Work - Diode");
        expect(windowTitle(folder, defaultProfile)).toBe("app - Diode");
        expect(windowTitle(empty, work)).toBe("Work - Diode");
    });

    it("окно из .code-workspace зовётся по файлу, как workspace.name расширений", () => {
        const fromFile: IWorkspace = { ...folder, configuration: Uri.file("/p/web.code-workspace") };
        expect(windowTitle(fromFile, work)).toBe("web (Workspace) - Work - Diode");
    });
});

describe("WindowTitleContribution", () => {
    let contribution: WindowTitleContribution | undefined;

    afterEach(() => {
        contribution?.dispose();
    });

    it("ставит заголовок при подъёме и на смену воркспейса; после dispose — нет", () => {
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
