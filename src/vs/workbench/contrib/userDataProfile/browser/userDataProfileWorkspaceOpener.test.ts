import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import { StateFileStore } from "../../../../platform/state/node/stateService.ts";
import {
    type IUserDataProfile,
    profileWorkspaceKeyOf,
} from "../../../../platform/userDataProfile/common/userDataProfile.ts";
import { UserDataProfilesService } from "../../../../platform/userDataProfile/node/userDataProfilesService.ts";
import type { IWorkspaceFileContents } from "../../../../platform/workspace/common/workspaceFile.ts";
import { LifecycleServiceDIToken } from "../../../services/lifecycle/browser/lifecycleService.ts";
import { HostProcessDIToken, type IRelaunchRequest } from "../../../services/lifecycle/common/hostProcess.ts";

import { type IWrappedWorkspaceOpener, UserDataProfileWorkspaceOpener } from "./userDataProfileWorkspaceOpener.ts";

describe("UserDataProfileWorkspaceOpener", () => {
    let ws: ITempWorkspace;
    let profiles: UserDataProfilesService;
    let restarts: (IRelaunchRequest | undefined)[];
    /** Opener calls under the wrapper: `["folder", path]` or `["file", path, contents]`. */
    let opened: unknown[][];
    let logger: ILogger;
    /** Farewell: `true` means Cancel in "Save changes?", `"throw"` means the reload path fails. */
    let shutdown: boolean | "throw";
    const contents: IWorkspaceFileContents = { folder: "/p", folderName: undefined };

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-profile-opener-" });
        const userDir = path.join(ws.dir, "User");
        profiles = new UserDataProfilesService({
            profilesHome: path.join(userDir, "profiles"),
            defaultProfileHome: userDir,
            state: new StateFileStore(undefined),
        });
        restarts = [];
        opened = [];
        shutdown = false;
        logger = {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            isEnabled: () => true,
        };
    });

    afterEach(() => {
        ws.dispose();
    });

    function opener(current: IUserDataProfile): UserDataProfileWorkspaceOpener {
        const inner: IWrappedWorkspaceOpener = {
            setWorkspaceFolder: (dirPath) => {
                opened.push(["folder", dirPath]);
            },
            openWorkspaceFile: (filePath, c) => {
                opened.push(["file", filePath, c]);
            },
        };
        const services = new Map<unknown, unknown>([
            [
                LifecycleServiceDIToken,
                {
                    requestShutdown: async (onProceed: () => unknown) => {
                        if (shutdown === "throw") throw new Error("boom");
                        if (!shutdown) await onProceed();
                    },
                    shutdown: async (_reason: string, then: () => void) => {
                        then();
                    },
                },
            ],
            [
                HostProcessDIToken,
                {
                    exit: () => undefined,
                    restart: (relaunch?: IRelaunchRequest) => {
                        restarts.push(relaunch);
                    },
                },
            ],
        ]);
        const accessor = {
            get(token: unknown) {
                if (services.has(token)) return services.get(token);
                throw new Error("unexpected token");
            },
        } as unknown as ServiceAccessor;
        return new UserDataProfileWorkspaceOpener(inner, profiles, { currentProfile: current }, accessor, logger);
    }

    const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

    it("папка с другим профилем — перезагрузка в него с новым воркспейсом в аргументах; папка окна не меняется", async () => {
        const work = await profiles.createNamedProfile("work");
        const dir = path.join(ws.dir, "proj");
        await profiles.setProfileForWorkspace(profileWorkspaceKeyOf(dir), work);

        opener(profiles.defaultProfile).setWorkspaceFolder(dir);
        await settle();

        expect(restarts).toEqual([{ profile: "work", workspace: profileWorkspaceKeyOf(dir) }]);
        expect(opened).toEqual([]);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("work"));
    });

    it("папка того же профиля — смена папки как есть, без перезагрузки", async () => {
        const work = await profiles.createNamedProfile("work");
        const dir = path.join(ws.dir, "proj");
        await profiles.setProfileForWorkspace(profileWorkspaceKeyOf(dir), work);

        opener(work).setWorkspaceFolder(dir);
        await settle();

        expect(restarts).toEqual([]);
        expect(opened).toEqual([["folder", dir]]);
        expect(logger.info).not.toHaveBeenCalled();
    });

    it("папка без привязки из именованного профиля — перезагрузка в Default", async () => {
        const work = await profiles.createNamedProfile("work");
        const dir = path.join(ws.dir, "proj");

        opener(work).setWorkspaceFolder(dir);
        await settle();

        expect(restarts).toEqual([{ profile: "Default", workspace: profileWorkspaceKeyOf(dir) }]);
        expect(opened).toEqual([]);
    });

    it("файл .code-workspace: ключ — файл; чужой профиль — перезагрузка, свой — открытие как есть", async () => {
        const work = await profiles.createNamedProfile("work");
        const file = path.join(ws.dir, "web.code-workspace");
        await profiles.setProfileForWorkspace(profileWorkspaceKeyOf(file), work);

        opener(profiles.defaultProfile).openWorkspaceFile(file, contents);
        opener(work).openWorkspaceFile(file, contents);
        await settle();

        expect(restarts).toEqual([{ profile: "work", workspace: profileWorkspaceKeyOf(file) }]);
        expect(opened).toEqual([["file", file, contents]]);
    });

    it("Cancel в «Save changes?» — окно остаётся в прежней папке и прежнем профиле", async () => {
        const work = await profiles.createNamedProfile("work");
        const dir = path.join(ws.dir, "proj");
        await profiles.setProfileForWorkspace(profileWorkspaceKeyOf(dir), work);
        shutdown = true;

        opener(profiles.defaultProfile).setWorkspaceFolder(dir);
        await settle();

        expect(restarts).toEqual([]);
        expect(opened).toEqual([]);
    });

    it("отказ пути перезагрузки — в лог, не в необработанный промис; папка не меняется", async () => {
        const work = await profiles.createNamedProfile("work");
        const dir = path.join(ws.dir, "proj");
        await profiles.setProfileForWorkspace(profileWorkspaceKeyOf(dir), work);
        shutdown = "throw";

        opener(profiles.defaultProfile).setWorkspaceFolder(dir);
        await settle();

        expect(restarts).toEqual([]);
        expect(opened).toEqual([]);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("failed"), expect.any(Error));
    });
});
