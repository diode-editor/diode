import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { Container } from "../../platform/instantiation/common/diContainer.ts";
import { StateFileStore } from "../../platform/state/node/stateService.ts";
import { TerminalTitleSinkDIToken } from "../../platform/terminal/common/terminalTitleSink.ts";
import { IUserDataProfilesServiceDIToken } from "../../platform/userDataProfile/common/userDataProfile.ts";
import { UserDataProfilesService } from "../../platform/userDataProfile/node/userDataProfilesService.ts";
import { IUserDataProfileServiceDIToken } from "../../workbench/services/userDataProfile/common/userDataProfile.ts";

import { userDataProfileModule } from "./userDataProfileModule.ts";

describe("userDataProfileModule", () => {
    function profiles(): UserDataProfilesService {
        const userDir = path.join("/never", "User");
        return new UserDataProfilesService({
            profilesHome: path.join(userDir, "profiles"),
            defaultProfileHome: userDir,
            state: new StateFileStore(undefined),
        });
    }

    it("биндит реестр, активный профиль и сток заголовка как есть", () => {
        const profilesService = profiles();
        const titles: string[] = [];
        const container = new Container().use(userDataProfileModule, {
            profilesService,
            currentProfile: profilesService.defaultProfile,
            terminalTitle: (title) => titles.push(title),
        });
        expect(container.get(IUserDataProfilesServiceDIToken)).toBe(profilesService);
        expect(container.get(IUserDataProfileServiceDIToken).currentProfile).toBe(profilesService.defaultProfile);
        container.get(TerminalTitleSinkDIToken)("x");
        expect(titles).toEqual(["x"]);
    });

    it("без стока заголовка — no-op, а не отсутствие биндинга", () => {
        const profilesService = profiles();
        const container = new Container().use(userDataProfileModule, {
            profilesService,
            currentProfile: profilesService.defaultProfile,
        });
        expect(() => {
            container.get(TerminalTitleSinkDIToken)("x");
        }).not.toThrow();
    });
});
