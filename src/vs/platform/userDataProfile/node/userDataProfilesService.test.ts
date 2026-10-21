import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { StateFileStore } from "../../state/node/stateService.ts";
import {
    DEFAULT_PROFILE_ID,
    type DidChangeProfilesEvent,
    PROFILE_ASSOCIATIONS_STATE,
    type StoredUserDataProfile,
    USER_DATA_PROFILES_STATE,
} from "../common/userDataProfile.ts";

import { UserDataProfilesService } from "./userDataProfilesService.ts";

function fakeLogger(): ILogger {
    return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), isEnabled: () => true };
}

describe("UserDataProfilesService", () => {
    let ws: ITempWorkspace;
    let userDir: string;
    let profilesHome: string;
    let state: StateFileStore;
    let logger: ILogger;
    let events: DidChangeProfilesEvent[];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-profiles-" });
        userDir = path.join(ws.dir, "User");
        profilesHome = path.join(userDir, "profiles");
        state = new StateFileStore(path.join(userDir, "globalStorage", "storage.json"), { writeDebounceMs: 5 });
        logger = fakeLogger();
        events = [];
    });

    afterEach(() => {
        state.dispose();
        ws.dispose();
    });

    function service(): UserDataProfilesService {
        const svc = new UserDataProfilesService({ profilesHome, defaultProfileHome: userDir, state, logger });
        svc.onDidChangeProfiles((e) => events.push(e));
        return svc;
    }

    it("без записей — один Default с файлами прямо в User/", () => {
        const svc = service();
        expect(svc.profiles.map((p) => p.name)).toEqual(["Default"]);
        expect(svc.defaultProfile.isDefault).toBe(true);
        expect(svc.defaultProfile.settingsResource).toBe(path.join(userDir, "settings.json"));
        expect(svc.profilesHome).toBe(profilesHome);
        expect(svc.defaultProfile.extensionsResource).toBe(path.join(userDir, "extensions.json"));
    });

    it("состав расширений Default — по переданному пути (каталог расширений), и в списке профилей тоже", () => {
        const extensionsResource = path.join(ws.dir, "extensions", "extensions.json");
        const svc = new UserDataProfilesService({
            profilesHome,
            defaultProfileHome: userDir,
            defaultProfileExtensionsResource: extensionsResource,
            state,
        });
        expect(svc.defaultProfile.extensionsResource).toBe(extensionsResource);
        expect(svc.defaultProfile.settingsResource).toBe(path.join(userDir, "settings.json"));
        expect(svc.profiles[0]?.extensionsResource).toBe(extensionsResource);
    });

    describe("createNamedProfile", () => {
        it("создаёт каталог, пишет запись с location относительно profilesHome и шлёт событие", async () => {
            const svc = service();
            const work = await svc.createNamedProfile(" Work ");
            expect(work).toMatchObject({ id: "Work", name: "Work", isDefault: false });
            expect(work.location).toBe(path.join(profilesHome, "Work"));
            expect(fs.statSync(work.location).isDirectory()).toBe(true);
            // A new profile has no extensions; the empty set is written explicitly.
            expect(work.extensionsResource).toBe(path.join(profilesHome, "Work", "extensions.json"));
            expect(fs.readFileSync(work.extensionsResource, "utf8")).toBe("[]");
            expect(state.get(USER_DATA_PROFILES_STATE)).toEqual([{ name: "Work", location: "Work" }]);
            expect(svc.profiles.map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID, "Work"]);
            expect(events).toEqual([{ added: [work], removed: [], updated: [], all: svc.profiles }]);
        });

        it("имя с пробелами — slug в каталоге, имя как есть; коллизия slug'а — суффикс", async () => {
            const svc = service();
            const a = await svc.createNamedProfile("my work");
            const b = await svc.createNamedProfile("my-work");
            expect(a.id).toBe("my-work");
            expect(b.id).toBe("my-work-2");
            expect(b.name).toBe("my-work");
            expect(svc.profiles.map((p) => p.name)).toEqual(["Default", "my work", "my-work"]);
        });

        it("отказы: пустое имя, занятое имя (включая Default)", async () => {
            const svc = service();
            await svc.createNamedProfile("work");
            await expect(svc.createNamedProfile("  ")).rejects.toThrow(/mandatory/);
            await expect(svc.createNamedProfile("work")).rejects.toThrow(/already exists/);
            await expect(svc.createNamedProfile("Default")).rejects.toThrow(/already exists/);
            expect(svc.profiles).toHaveLength(2);
        });

        it("с воркспейсом — сразу привязывает его", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work", "/p/app");
            expect(svc.getProfileForWorkspace("/p/app")).toEqual(work);
            expect(state.get(PROFILE_ASSOCIATIONS_STATE)).toEqual({ workspaces: { "/p/app": "work" } });
        });

        it("реестр переживает перезапуск: новый сервис над тем же стором видит профиль", async () => {
            await service().createNamedProfile("work");
            const reopened = new UserDataProfilesService({ profilesHome, defaultProfileHome: userDir, state });
            expect(reopened.profiles.map((p) => p.name)).toEqual(["Default", "work"]);
            expect(reopened.profiles[1]?.settingsResource).toBe(path.join(profilesHome, "work", "settings.json"));
        });
    });

    describe("updateProfile", () => {
        it("переименовывает, не трогая id и каталог", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            const renamed = await svc.updateProfile(work, { name: "Work 2" });
            expect(renamed).toMatchObject({ id: "work", name: "Work 2", location: work.location });
            expect(state.get(USER_DATA_PROFILES_STATE)).toEqual([{ name: "Work 2", location: "work" }]);
            expect(events.at(-1)).toEqual({ added: [], removed: [], updated: [renamed], all: svc.profiles });
            expect((await svc.updateProfile(renamed, {})).name).toBe("Work 2");
        });

        it("переименование в то же имя — не коллизия; соседи не меняются", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            await svc.createNamedProfile("home");
            await expect(svc.updateProfile(work, { name: "work" })).resolves.toMatchObject({ name: "work" });
            await svc.updateProfile(work, { name: "Work" });
            expect(svc.profiles.map((p) => [p.id, p.name])).toEqual([
                [DEFAULT_PROFILE_ID, "Default"],
                ["work", "Work"],
                ["home", "home"],
            ]);
        });

        it("отказы: Default, неизвестный профиль, занятое или пустое имя", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            await svc.createNamedProfile("home");
            await expect(svc.updateProfile(svc.defaultProfile, { name: "x" })).rejects.toThrow(/default/);
            await expect(svc.updateProfile({ ...work, id: "ghost" }, { name: "x" })).rejects.toThrow(/does not exist/);
            await expect(svc.updateProfile(work, { name: "home" })).rejects.toThrow(/already exists/);
            await expect(svc.updateProfile(work, { name: " " })).rejects.toThrow(/mandatory/);
            // Its own name isn't a collision.
            expect((await svc.updateProfile(work, { name: "work" })).name).toBe("work");
        });
    });

    describe("removeProfile", () => {
        it("снимает запись, привязки на него и каталог; остальные привязки целы", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work", "/p/app");
            const home = await svc.createNamedProfile("home", "/p/other");
            fs.writeFileSync(path.join(work.location, "settings.json"), "{}");
            await svc.removeProfile(work);
            expect(svc.profiles.map((p) => p.name)).toEqual(["Default", "home"]);
            expect(fs.existsSync(work.location)).toBe(false);
            expect(svc.getProfileForWorkspace("/p/app")).toBeUndefined();
            expect(svc.getProfileForWorkspace("/p/other")).toEqual(home);
            expect(events.at(-1)).toEqual({ added: [], removed: [work], updated: [], all: svc.profiles });
        });

        it("последний профиль снят — ключи реестра и привязок уходят из файла", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work", "/p/app");
            await svc.removeProfile(work);
            expect(state.get(USER_DATA_PROFILES_STATE)).toEqual([]);
            expect(state.get(PROFILE_ASSOCIATIONS_STATE)).toEqual({});
            state.flushSync();
            expect(JSON.parse(fs.readFileSync(path.join(userDir, "globalStorage", "storage.json"), "utf-8"))).toEqual(
                {},
            );
        });

        it("каталог уже снесён руками — удаление проходит без ошибки в логе", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            fs.rmSync(work.location, { recursive: true });
            await svc.removeProfile(work);
            expect(svc.profiles.map((p) => p.name)).toEqual(["Default"]);
            expect(logger.error).not.toHaveBeenCalled();
        });

        it("отказы: Default и неизвестный профиль", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            await expect(svc.removeProfile(svc.defaultProfile)).rejects.toThrow(/default/);
            await expect(svc.removeProfile({ ...work, id: "ghost" })).rejects.toThrow(/does not exist/);
        });

        it("имя `..` не уводит каталог из profiles/, и удаление не трогает User/", async () => {
            const svc = service();
            fs.mkdirSync(userDir, { recursive: true });
            fs.writeFileSync(path.join(userDir, "settings.json"), "{}");
            const dots = await svc.createNamedProfile("..");
            expect(dots.location).toBe(path.join(profilesHome, "profile"));
            await svc.removeProfile(dots);
            expect(fs.existsSync(path.join(userDir, "settings.json"))).toBe(true);
        });

        it("каталог вне profiles/ (абсолютный location из рук) — запись снимается, каталог остаётся", async () => {
            const abs = path.join(ws.dir, "elsewhere", "old");
            fs.mkdirSync(abs, { recursive: true });
            state.store(USER_DATA_PROFILES_STATE, [{ name: "old", location: abs }]);
            const svc = service();
            const [, old] = svc.profiles;
            await svc.removeProfile(old);
            expect(svc.profiles.map((p) => p.name)).toEqual(["Default"]);
            expect(fs.existsSync(abs)).toBe(true);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(abs));
        });

        it("каталог не удалился — ошибка в лог, профиль всё равно снят", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            const rm = vi.spyOn(fs.promises, "rm").mockRejectedValueOnce(new Error("EBUSY"));
            await svc.removeProfile(work);
            rm.mockRestore();
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to delete"), expect.anything());
            expect(svc.profiles).toHaveLength(1);
        });
    });

    describe("setProfileForWorkspace / getProfileForWorkspace", () => {
        it("пишет путь → id; переназначение перезаписывает; Default снимает запись", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            const home = await svc.createNamedProfile("home");
            await svc.setProfileForWorkspace("/p/app", work);
            await svc.setProfileForWorkspace("/p/web.code-workspace", home);
            expect(state.get(PROFILE_ASSOCIATIONS_STATE)).toEqual({
                workspaces: { "/p/app": "work", "/p/web.code-workspace": "home" },
            });
            await svc.setProfileForWorkspace("/p/app", home);
            expect(svc.getProfileForWorkspace("/p/app")).toEqual(home);
            await svc.setProfileForWorkspace("/p/app", svc.defaultProfile);
            expect(svc.getProfileForWorkspace("/p/app")).toBeUndefined();
            expect(state.get(PROFILE_ASSOCIATIONS_STATE)).toEqual({ workspaces: { "/p/web.code-workspace": "home" } });
        });

        it("неизвестный профиль — отказ; привязка на несуществующий id читается как отсутствие", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            await expect(svc.setProfileForWorkspace("/p/app", { ...work, id: "ghost" })).rejects.toThrow(
                /does not exist/,
            );
            state.store(PROFILE_ASSOCIATIONS_STATE, { workspaces: { "/p/app": "ghost" } });
            expect(svc.getProfileForWorkspace("/p/app")).toBeUndefined();
        });
    });

    describe("загрузка реестра", () => {
        it("битые записи пропускаются с warn, абсолютный location берётся как есть", () => {
            const abs = path.join(ws.dir, "elsewhere", "old");
            const stored: unknown[] = [
                { name: "work", location: "work" },
                { name: "", location: "x" },
                { name: "nolocation", location: "" },
                null,
                undefined,
                { name: ["work"], location: "arr" },
                { name: "arr", location: ["arr"] },
                { name: "old", location: abs },
                { name: "up", location: ".." },
                { name: "escape", location: "../x" },
                { name: "here", location: "." },
                { name: "default", location: "default" },
            ];
            state.store(USER_DATA_PROFILES_STATE, stored as StoredUserDataProfile[]);
            const svc = service();
            expect(svc.profiles.map((p) => [p.id, p.name, p.location])).toEqual([
                [DEFAULT_PROFILE_ID, "Default", userDir],
                ["work", "work", path.join(profilesHome, "work")],
                ["old", "old", abs],
            ]);
            expect(logger.warn).toHaveBeenCalledTimes(10);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("invalid location"), {
                name: "up",
                location: "..",
            });
        });
    });

    describe("migrateProfileDirectories", () => {
        it("регистрирует каталоги без записи именем каталога, уже известные не трогает", async () => {
            const svc = service();
            await svc.createNamedProfile("known");
            fs.mkdirSync(path.join(profilesHome, "legacy"), { recursive: true });
            fs.mkdirSync(path.join(profilesHome, "other"), { recursive: true });
            fs.writeFileSync(path.join(profilesHome, "a-file"), "");
            const added = svc.migrateProfileDirectories();
            expect(added.map((p) => p.name)).toEqual(["legacy", "other"]);
            expect(svc.profiles.map((p) => p.name)).toEqual(["Default", "known", "legacy", "other"]);
            expect(state.get(USER_DATA_PROFILES_STATE)).toEqual([
                { name: "known", location: "known" },
                { name: "legacy", location: "legacy" },
                { name: "other", location: "other" },
            ]);
            expect(events.at(-1)).toEqual({ added, removed: [], updated: [], all: svc.profiles });
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("2"), { profiles: ["legacy", "other"] });
            expect(svc.migrateProfileDirectories()).toEqual([]);
            expect(logger.info).toHaveBeenCalledTimes(1);
        });

        it("нет profilesHome — пусто без ошибок; каталог с недопустимым именем пропускается с warn", () => {
            const svc = service();
            expect(svc.migrateProfileDirectories()).toEqual([]);
            expect(logger.error).not.toHaveBeenCalled();
            fs.mkdirSync(path.join(profilesHome, "bad name"), { recursive: true });
            fs.mkdirSync(path.join(profilesHome, "default"), { recursive: true });
            expect(svc.migrateProfileDirectories()).toEqual([]);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("bad name"));
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("default"));
        });

        it("каталог, чьё имя уже занято профилем с другим каталогом, получает отличимое имя", async () => {
            const svc = service();
            // Profile `work` is renamed to `Work` and lives in `work/`; directory
            // `Work/` was created by hand, and the names must not clash.
            const work = await svc.createNamedProfile("work");
            await svc.updateProfile(work, { name: "Work" });
            fs.mkdirSync(path.join(profilesHome, "Work"), { recursive: true });
            const added = svc.migrateProfileDirectories();
            expect(added.map((p) => [p.id, p.name])).toEqual([["Work", "Work (Work)"]]);
        });

        it("readdir упал не по ENOENT — ошибка в лог, пусто", () => {
            const svc = service();
            fs.mkdirSync(userDir, { recursive: true });
            fs.writeFileSync(profilesHome, "not a dir");
            expect(svc.migrateProfileDirectories()).toEqual([]);
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to scan"), expect.anything());
        });
    });
});
