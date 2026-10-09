import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import {
    createExtensionApi,
    ExtensionApiFactory,
    OWNED_MEMBERS,
    VSCODE_CJS_CACHE_KEY,
    VSCODE_ESM_URL,
} from "./extensionApiFactory.ts";
import { ExtensionPaths } from "./extensionPaths.ts";
import { ExtensionOwner } from "./vscodeHostContext.ts";

/** Вызов члена общего namespace, как его увидела общая фабрика. */
interface ICall {
    readonly member: string;
    readonly owner: string | undefined;
    readonly self: unknown;
    readonly args: unknown[];
}

/** Value-тип-подделка: важна только идентичность класса. */
class FakePosition {
    public readonly fake = true;
}

/**
 * Общий namespace-подделка: каждый «создающий» член пишет, с каким владельцем
 * его позвали, — так видно, что выставил оверлей. Плюс живой геттер и
 * не-создающий член для проверки делегирования.
 */
function makeShared(owner: ExtensionOwner): {
    shared: typeof vscode;
    calls: ICall[];
    setActive: (value: string | undefined) => void;
} {
    const calls: ICall[] = [];
    let active: string | undefined;
    const recorder = (member: string) =>
        function (this: unknown, ...args: unknown[]): string {
            calls.push({ member, owner: owner.current, self: this, args });
            return `result:${member}`;
        };
    const withMembers = (names: readonly string[], extra: object): object => {
        const ns: Record<string, unknown> = { ...extra };
        for (const name of names) ns[name] = recorder(name);
        return ns;
    };
    const window = Object.defineProperty(
        withMembers(OWNED_MEMBERS.window, { showInformationMessage: recorder("showInformationMessage") }),
        "activeTextEditor",
        { get: () => active, enumerable: true, configurable: true },
    );
    const shared = {
        version: "1.0.0",
        Position: FakePosition,
        workspace: withMembers(OWNED_MEMBERS.workspace, { name: "ws" }),
        tasks: withMembers(OWNED_MEMBERS.tasks, { fetchTasks: recorder("fetchTasks") }),
        env: { appName: "Diode" },
        window,
        languages: withMembers(OWNED_MEMBERS.languages, { match: recorder("match") }),
        commands: withMembers(OWNED_MEMBERS.commands, { executeCommand: recorder("executeCommand") }),
    } as unknown as typeof vscode;
    return {
        shared,
        calls,
        setActive: (value) => {
            active = value;
        },
    };
}

const ROOT_A = path.resolve("/ext/pub.a");
const ROOT_B = path.resolve("/ext/pub.b");

function makeFactory(): {
    factory: ExtensionApiFactory;
    shared: typeof vscode;
    warnings: string[];
    paths: ExtensionPaths;
} {
    const owner = new ExtensionOwner();
    const { shared } = makeShared(owner);
    const paths = new ExtensionPaths();
    paths.add(ROOT_A, "pub.a");
    paths.add(ROOT_B, "pub.b");
    const warnings: string[] = [];
    const factory = new ExtensionApiFactory({ shared, owner, paths, warn: (m) => warnings.push(m) });
    return { factory, shared, warnings, paths };
}

describe("createExtensionApi — оверлей поверх общего namespace", () => {
    it("свой объект, но те же value-типы и неперекрытые неймспейсы", () => {
        const owner = new ExtensionOwner();
        const { shared } = makeShared(owner);
        const api = createExtensionApi(shared, owner, "pub.a");
        expect(api).not.toBe(shared);
        expect(api.Position).toBe(shared.Position);
        expect(api.version).toBe("1.0.0");
        expect(api.env).toBe(shared.env);
        expect(api.workspace).not.toBe(shared.workspace);
        expect(api.workspace.name).toBe("ws");
        expect(api.tasks).not.toBe(shared.tasks);
        expect(api.window).not.toBe(shared.window);
        expect(api.languages).not.toBe(shared.languages);
        expect(api.commands).not.toBe(shared.commands);
    });

    it("собственные ключи совпадают с общим namespace (`__importStar`, Object.keys)", () => {
        const owner = new ExtensionOwner();
        const { shared } = makeShared(owner);
        const api = createExtensionApi(shared, owner, "pub.a");
        expect(Object.keys(api)).toEqual(Object.keys(shared));
        expect(Object.keys(api.window)).toEqual(Object.keys(shared.window));
        expect(Object.keys(api.languages)).toEqual(Object.keys(shared.languages));
        expect(Object.keys(api.commands)).toEqual(Object.keys(shared.commands));
        expect(Object.getPrototypeOf(api)).toBe(shared);
        expect(Object.getPrototypeOf(api.window)).toBe(shared.window);
    });

    it("геттер window.activeTextEditor остаётся живым (не снимок)", () => {
        const owner = new ExtensionOwner();
        const { shared, setActive } = makeShared(owner);
        const api = createExtensionApi(shared, owner, "pub.a");
        expect(api.window.activeTextEditor).toBeUndefined();
        setActive("editor-1");
        expect(api.window.activeTextEditor).toBe("editor-1");
    });

    it("неперекрытый член — та же функция общего namespace, без владельца", () => {
        const owner = new ExtensionOwner();
        const { shared, calls } = makeShared(owner);
        const api = createExtensionApi(shared, owner, "pub.a");
        expect(api.window.showInformationMessage).toBe(shared.window.showInformationMessage);
        void api.commands.executeCommand("x");
        expect(calls).toEqual([expect.objectContaining({ member: "executeCommand", owner: undefined })]);
    });

    it("обёртка создающего члена — такое же свойство, как у общего namespace (перечислимое, перезаписываемое)", () => {
        const owner = new ExtensionOwner();
        const { shared } = makeShared(owner);
        const api = createExtensionApi(shared, owner, "pub.a");
        expect(Object.getOwnPropertyDescriptor(api.window, "createOutputChannel")).toMatchObject({
            enumerable: true,
            configurable: true,
            writable: true,
        });
    });

    it("каждый создающий член зовётся с владельцем, аргументами и this общего неймспейса", () => {
        const owner = new ExtensionOwner();
        const { shared, calls } = makeShared(owner);
        const api = createExtensionApi(shared, owner, "pub.a");
        const groups = [
            ["window", OWNED_MEMBERS.window],
            ["languages", OWNED_MEMBERS.languages],
            ["commands", OWNED_MEMBERS.commands],
        ] as const;
        for (const [ns, members] of groups) {
            const overlay = api[ns] as unknown as Record<string, (...args: unknown[]) => unknown>;
            for (const member of members) {
                calls.length = 0;
                expect(overlay[member]("arg1", 2)).toBe(`result:${member}`);
                expect(calls).toEqual([{ member, owner: "pub.a", self: shared[ns], args: ["arg1", 2] }]);
                expect(owner.current).toBeUndefined();
            }
        }
    });

    it("владелец восстанавливается, даже если общий член бросил", () => {
        const owner = new ExtensionOwner();
        const shared = {
            window: {
                createOutputChannel: () => {
                    throw new Error("boom");
                },
            },
            languages: {},
            commands: {},
            tasks: {},
            workspace: {},
        } as unknown as typeof vscode;
        const api = createExtensionApi(shared, owner, "pub.a");
        owner.runAs("pub.outer", () => {
            expect(() => api.window.createOutputChannel("x")).toThrow("boom");
            expect(owner.current).toBe("pub.outer");
        });
    });

    it("оверлеи двух расширений выставляют каждый своего владельца", () => {
        const owner = new ExtensionOwner();
        const { shared, calls } = makeShared(owner);
        createExtensionApi(shared, owner, "pub.a").commands.registerCommand("a", () => undefined);
        createExtensionApi(shared, owner, "pub.b").commands.registerCommand("b", () => undefined);
        expect(calls.map((c) => c.owner)).toEqual(["pub.a", "pub.b"]);
    });
});

describe("ExtensionApiFactory — раздача по импортёру", () => {
    it("forPath: модуль внутри корня получает API своего расширения, кэш по id", () => {
        const { factory, shared } = makeFactory();
        const a1 = factory.forPath(path.join(ROOT_A, "dist", "main.js"));
        const a2 = factory.forPath(path.join(ROOT_A, "node_modules", "lib", "index.js"));
        const b = factory.forPath(path.join(ROOT_B, "main.js"));
        expect(a1).toBe(a2);
        expect(a1).toBe(factory.forId("pub.a"));
        expect(a1).not.toBe(b);
        expect(a1).not.toBe(shared);
        expect(a1.Position).toBe(b.Position);
    });

    it("неопознанный импортёр — общий namespace и ровно одно предупреждение", () => {
        const { factory, shared, warnings } = makeFactory();
        expect(factory.forPath(path.resolve("/elsewhere/a.js"))).toBe(shared);
        expect(factory.forPath(undefined)).toBe(shared);
        expect(factory.forPath(path.resolve("/elsewhere/b.js"))).toBe(shared);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(path.resolve("/elsewhere/a.js"));
        expect(warnings[0]).toContain("shared API without extension identity");
    });

    it("импортёр неизвестен вовсе — в предупреждении так и сказано", () => {
        const { factory, warnings } = makeFactory();
        factory.forPath(undefined);
        expect(warnings).toEqual([expect.stringContaining("(unknown importer)")]);
    });

    it("опознанный импортёр не предупреждает", () => {
        const { factory, warnings } = makeFactory();
        factory.forPath(path.join(ROOT_A, "main.js"));
        expect(warnings).toEqual([]);
    });

    it("lookup: без id — общий namespace, с id — API расширения", () => {
        const { factory, shared } = makeFactory();
        expect(factory.lookup()).toBe(shared);
        expect(factory.lookup("pub.a")).toBe(factory.forId("pub.a"));
    });

    it("cjsModule: ключ кэша на расширение, общий — под прежним ключом", () => {
        const { factory, shared } = makeFactory();
        const own = factory.cjsModule(path.join(ROOT_A, "main.js"));
        expect(own.key).toBe(`${VSCODE_CJS_CACHE_KEY}:pub.a`);
        expect(own.exports).toBe(factory.forId("pub.a"));
        const foreign = factory.cjsModule(path.resolve("/elsewhere/a.js"));
        expect(foreign.key).toBe("vscode");
        expect(foreign.exports).toBe(shared);
    });

    it("esmUrl: file-URL импортёра → URL модуля его расширения", () => {
        const { factory } = makeFactory();
        expect(factory.esmUrl(pathToFileURL(path.join(ROOT_A, "extension.js")).href)).toBe(`${VSCODE_ESM_URL}/pub.a`);
        expect(factory.esmUrl(pathToFileURL(path.resolve("/elsewhere/x.mjs")).href)).toBe(VSCODE_ESM_URL);
        expect(factory.esmUrl(undefined)).toBe(VSCODE_ESM_URL);
    });

    it("esmUrl: не-файловый импортёр не трактуется как путь", () => {
        const { factory, paths, warnings } = makeFactory();
        // `data:x` как путь резолвится от cwd — корень в cwd поймал бы его.
        paths.add(process.cwd(), "pub.cwd");
        expect(factory.esmUrl("data:text/javascript,x")).toBe(VSCODE_ESM_URL);
        expect(warnings).toEqual([expect.stringContaining("(data:text/javascript,x)")]);
    });

    it("esmUrl: id экранируется в URL и обратно разбирается esmSource", () => {
        const { factory, paths } = makeFactory();
        paths.add(path.resolve("/ext/odd"), "pub.a b/c");
        const url = factory.esmUrl(pathToFileURL(path.resolve("/ext/odd/x.js")).href);
        expect(url).toBe(`${VSCODE_ESM_URL}/pub.a%20b%2Fc`);
        expect(factory.esmSource(url)).toContain('globalThis[Symbol.for("diode.vscodeApi")]("pub.a b/c");');
    });

    it("esmSource: имена export'ов — полный состав общего namespace", () => {
        const { factory } = makeFactory();
        const own = factory.esmSource(`${VSCODE_ESM_URL}/pub.a`);
        expect(own).toContain('globalThis[Symbol.for("diode.vscodeApi")]("pub.a");');
        for (const name of ["version", "Position", "workspace", "window", "languages", "commands"]) {
            expect(own).toContain(`export const ${name} = ns["${name}"];`);
        }
        expect(factory.esmSource(VSCODE_ESM_URL)).toContain('globalThis[Symbol.for("diode.vscodeApi")]();');
    });

    it("esmSource: чужой URL — не наш (undefined), в том числе похожий префикс", () => {
        const { factory } = makeFactory();
        expect(factory.esmSource("file:///x.js")).toBeUndefined();
        expect(factory.esmSource(`${VSCODE_ESM_URL}x`)).toBeUndefined();
    });
});
