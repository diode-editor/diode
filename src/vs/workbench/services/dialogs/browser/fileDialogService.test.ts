import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IEnvironmentService } from "../../../../platform/environment/common/environment.ts";
import { FileService } from "../../../../platform/files/common/fileService.ts";
import { InMemoryFileSystemProvider } from "../../../../platform/files/common/inMemoryFileSystemProvider.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { QuickInputComponent } from "../../../browser/parts/quickinput/quickInputComponent.ts";
import { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";

import { FileDialogService } from "./fileDialogService.ts";

const disposables = new DisposableStore();
afterEach(() => {
    disposables.clear();
});

async function setup(folders: readonly string[]) {
    const files = disposables.add(new FileService());
    disposables.add(files.registerProvider("file", new InMemoryFileSystemProvider()));
    for (const dir of ["/home", "/home/u", "/ws"]) await files.createFolder(Uri.file(dir));
    const component = new QuickInputComponent();
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    const workspace = {
        getWorkspace: () => ({ folders: folders.map((folder) => ({ uri: Uri.file(folder) })) }),
    } as unknown as IWorkspaceContextService;
    const service = new FileDialogService(
        new QuickInputService(component),
        files,
        { userHome: "/home/u" } as IEnvironmentService,
        workspace,
    );
    return { service, component, testApp };
}

describe("FileDialogService", () => {
    it("without defaultUri opens the dialog in the workspace folder", async () => {
        const { service, component, testApp } = await setup(["/ws"]);
        const result = service.showOpenDialog();
        await vi.waitFor(() => {
            expect(component.view.getQuery()).toBe("/ws/");
        });
        testApp.sendKey("Escape");
        await expect(result).resolves.toBeUndefined();
    });

    it("without a folder opens in the home folder; save uses the same dialog", async () => {
        const { service, component, testApp } = await setup([]);
        const result = service.showSaveDialog();
        await vi.waitFor(() => {
            expect(component.view.getQuery()).toBe("/home/u/");
        });
        testApp.sendKey("Escape");
        await expect(result).resolves.toBeUndefined();
    });
});
