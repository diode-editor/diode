import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { Event } from "../../../base/common/event.ts";
import { Uri } from "../../../base/common/uri.ts";
import type { IWorkspace } from "../../workspace/common/iWorkspaceContextService.ts";

import {
    createDefaultProfile,
    DEFAULT_PROFILE_ID,
    DEFAULT_PROFILE_NAME,
    isValidProfileId,
    type IUserDataProfile,
    type IUserDataProfilesService,
    MAX_PROFILE_ID_LENGTH,
    PROFILE_ID_PATTERN,
    profileForWorkspace,
    profileIdFromName,
    profileWorkspaceKey,
    profileWorkspaceKeyOf,
    resolveActiveProfile,
    toUserDataProfile,
} from "./userDataProfile.ts";

describe("toUserDataProfile / createDefaultProfile", () => {
    it("раскладывает ресурсы по каталогу профиля", () => {
        const p = toUserDataProfile("work", "Work", "/u/User/profiles/work");
        expect(p).toEqual({
            id: "work",
            name: "Work",
            isDefault: false,
            location: "/u/User/profiles/work",
            settingsResource: path.join("/u/User/profiles/work", "settings.json"),
            keybindingsResource: path.join("/u/User/profiles/work", "keybindings.json"),
            globalStorageHome: path.join("/u/User/profiles/work", "globalStorage"),
            extensionsResource: path.join("/u/User/profiles/work", "extensions.json"),
        });
    });

    it("Default живёт прямо в User/ с id и именем эталона", () => {
        const d = createDefaultProfile("/u/User");
        expect(d.isDefault).toBe(true);
        expect(d.id).toBe(DEFAULT_PROFILE_ID);
        expect(d.name).toBe(DEFAULT_PROFILE_NAME);
        expect(d.settingsResource).toBe(path.join("/u/User", "settings.json"));
    });
});

describe("profileIdFromName", () => {
    it("оставляет допустимое имя как есть, с регистром", () => {
        expect(profileIdFromName("My.Work_1-x", [])).toBe("My.Work_1-x");
    });

    it("схлопывает пробелы и чужие символы в один дефис, обрезает края", () => {
        expect(profileIdFromName("  Моя работа / 2 ", [])).toBe("2");
        expect(profileIdFromName("a  b\tc", [])).toBe("a-b-c");
        expect(profileIdFromName("--x--", [])).toBe("x");
    });

    it("пустой остаток — `profile`", () => {
        expect(profileIdFromName("   ", [])).toBe("profile");
        expect(profileIdFromName("///", [])).toBe("profile");
    });

    it("коллизия с занятым id — числовой суффикс по первому свободному", () => {
        expect(profileIdFromName("a b", ["a-b"])).toBe("a-b-2");
        expect(profileIdFromName("a b", ["a-b", "a-b-2"])).toBe("a-b-3");
        expect(profileIdFromName("a b", ["a-b-2"])).toBe("a-b");
    });

    it("одни точки — `profile`: `.` и `..` увели бы каталог в `profiles/` и `User/`", () => {
        expect(profileIdFromName(".", [])).toBe("profile");
        expect(profileIdFromName("..", [])).toBe("profile");
        expect(profileIdFromName(" .. ", [])).toBe("profile");
        expect(profileIdFromName("a/../..", [])).toBe("a-..-..");
    });

    it("имя устройства Windows (и с расширением) — префикс `profile-`; похожие имена — как есть", () => {
        expect(profileIdFromName("con", [])).toBe("profile-con");
        expect(profileIdFromName("NUL.txt", [])).toBe("profile-NUL.txt");
        expect(profileIdFromName("COM1", [])).toBe("profile-COM1");
        expect(profileIdFromName("lpt9", [])).toBe("profile-lpt9");
        expect(profileIdFromName("console", [])).toBe("console");
        expect(profileIdFromName("com0", [])).toBe("com0");
        expect(profileIdFromName("con", ["profile-con"])).toBe("profile-con-2");
    });

    it("`default` занят Default-профилем путей — суффикс", () => {
        expect(profileIdFromName("default", [])).toBe("default-2");
        expect(profileIdFromName("default", ["default-2"])).toBe("default-3");
    });

    it("занятость — без учёта регистра (на macOS и Windows `Work` и `work` — один каталог), регистр id сохраняется", () => {
        expect(profileIdFromName("work", ["Work"])).toBe("work-2");
        expect(profileIdFromName("Work", ["work", "WORK-2"])).toBe("Work-3");
        expect(profileIdFromName("DEFAULT", [])).toBe("DEFAULT-2");
    });

    it("длинное имя обрезается до предела имени каталога, без висячего дефиса", () => {
        expect(profileIdFromName("x".repeat(300), [])).toBe("x".repeat(MAX_PROFILE_ID_LENGTH));
        expect(profileIdFromName(`${"x".repeat(MAX_PROFILE_ID_LENGTH - 1)} y`, [])).toBe(
            "x".repeat(MAX_PROFILE_ID_LENGTH - 1),
        );
    });
});

describe("isValidProfileId / PROFILE_ID_PATTERN", () => {
    it("id — имя каталога прямо в profiles/: не `.`/`..`, не `default`, только алфавит slug'а", () => {
        expect(isValidProfileId("work.v2_x-1")).toBe(true);
        expect(isValidProfileId("...")).toBe(true);
        expect(isValidProfileId("Default")).toBe(true);
        expect(isValidProfileId(".")).toBe(false);
        expect(isValidProfileId("..")).toBe(false);
        expect(isValidProfileId("default")).toBe(false);
        expect(isValidProfileId("a/b")).toBe(false);
        expect(isValidProfileId("")).toBe(false);
        expect(PROFILE_ID_PATTERN.test("..")).toBe(false);
        expect(PROFILE_ID_PATTERN.test("..a")).toBe(true);
    });
});

describe("profileWorkspaceKey", () => {
    it("пустое окно — ключа нет", () => {
        expect(profileWorkspaceKey({ id: null, folders: [] })).toBeUndefined();
    });

    it("папка — её путь; файл воркспейса приоритетнее папки", () => {
        const folder: IWorkspace = {
            id: "x",
            folders: [{ uri: Uri.file("/p/app"), name: "app", index: 0 }],
        };
        expect(profileWorkspaceKey(folder)).toBe(profileWorkspaceKeyOf("/p/app"));
        const fromFile: IWorkspace = { ...folder, configuration: Uri.file("/p/web.code-workspace") };
        expect(profileWorkspaceKey(fromFile)).toBe(profileWorkspaceKeyOf("/p/web.code-workspace"));
        expect(profileWorkspaceKey(fromFile)).not.toBe(profileWorkspaceKey(folder));
    });

    it("ключ по строке — абсолютный путь в форме fsPath, одинаковый у бутстрапа и окна", () => {
        const key = profileWorkspaceKeyOf("/p/./app/../app");
        expect(key).toBe(Uri.file(path.resolve("/p/app")).fsPath);
        expect(profileWorkspaceKeyOf(key)).toBe(key);
    });
});

describe("resolveActiveProfile", () => {
    const defaultProfile = createDefaultProfile("/u/User");
    const work = toUserDataProfile("work", "work", "/u/User/profiles/work");

    function service(profiles: IUserDataProfile[], associations: Record<string, IUserDataProfile> = {}) {
        const svc: IUserDataProfilesService = {
            profilesHome: "/u/User/profiles",
            defaultProfile,
            profiles,
            onDidChangeProfiles: Event.None,
            createNamedProfile: vi.fn(async (name: string) =>
                toUserDataProfile(name, name, `/u/User/profiles/${name}`),
            ),
            updateProfile: vi.fn(),
            removeProfile: vi.fn(),
            setProfileForWorkspace: vi.fn(async () => undefined),
            // Contract: the key is a string; an empty window never reaches the registry.
            getProfileForWorkspace: (key: unknown) => {
                if (typeof key !== "string") throw new Error("ключ привязки — строка");
                return associations[key];
            },
        };
        return svc;
    }

    it("без флага и привязки — Default", async () => {
        const svc = service([defaultProfile, work]);
        expect(await resolveActiveProfile(svc, { workspace: "/p/app" })).toBe(defaultProfile);
        expect(await resolveActiveProfile(svc, {})).toBe(defaultProfile);
        expect(svc.setProfileForWorkspace).not.toHaveBeenCalled();
    });

    it("привязка воркспейса побеждает Default", async () => {
        const svc = service([defaultProfile, work], { "/p/app": work });
        expect(await resolveActiveProfile(svc, { workspace: "/p/app" })).toBe(work);
    });

    it("--profile находит по имени, побеждает привязку и сам привязывает воркспейс", async () => {
        const svc = service([defaultProfile, work], { "/p/app": defaultProfile });
        expect(await resolveActiveProfile(svc, { forceProfile: "work", workspace: "/p/app" })).toBe(work);
        expect(svc.setProfileForWorkspace).toHaveBeenCalledWith("/p/app", work);
        expect(svc.createNamedProfile).not.toHaveBeenCalled();
    });

    it("--profile Default — именованный Default, привязка снимается через него же", async () => {
        const svc = service([defaultProfile, work], { "/p/app": work });
        expect(await resolveActiveProfile(svc, { forceProfile: "Default", workspace: "/p/app" })).toBe(defaultProfile);
        expect(svc.setProfileForWorkspace).toHaveBeenCalledWith("/p/app", defaultProfile);
    });

    it("--profile с неизвестным именем создаёт пустой профиль; без воркспейса ничего не привязывает", async () => {
        const svc = service([defaultProfile]);
        const created = await resolveActiveProfile(svc, { forceProfile: " new " });
        expect(created.name).toBe("new");
        expect(svc.createNamedProfile).toHaveBeenCalledWith("new");
        expect(svc.setProfileForWorkspace).not.toHaveBeenCalled();
    });

    it("пустой --profile — как без флага", async () => {
        const svc = service([defaultProfile, work], { "/p/app": work });
        expect(await resolveActiveProfile(svc, { forceProfile: "  ", workspace: "/p/app" })).toBe(work);
        expect(svc.createNamedProfile).not.toHaveBeenCalled();
    });

    it("profileForWorkspace: привязка → её профиль, без привязки и у пустого окна → Default", () => {
        const svc = service([defaultProfile, work], { "/p/app": work });
        expect(profileForWorkspace(svc, "/p/app")).toBe(work);
        expect(profileForWorkspace(svc, "/p/other")).toBe(defaultProfile);
        expect(profileForWorkspace(svc, undefined)).toBe(defaultProfile);
    });
});
