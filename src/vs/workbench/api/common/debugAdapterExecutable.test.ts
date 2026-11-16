import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    definesDebugType,
    type IDebuggerExtension,
    mainDebugTypes,
    platformAdapterExecutable,
} from "./debugAdapterExecutable.ts";
import { DebugAdapterExecutable } from "./debugTypes.ts";

function extension(extensionPath: string, debuggers: unknown): IDebuggerExtension {
    return { extensionPath, packageJSON: { contributes: { debuggers } } };
}

const executable = (command: string, args: string[]) => new DebugAdapterExecutable(command, args);

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("platformAdapterExecutable — upstream ExecutableDebugAdapter.platformAdapterExecutable", () => {
    it("`program` is the adapter, relative to the extension; its `args` follow", () => {
        const ext = extension("/ext/a", [{ type: "lldb", program: "./bin/codelldb", args: ["--port"] }]);
        expect(platformAdapterExecutable([ext], "lldb", "linux")).toEqual(
            executable(path.join("/ext/a", "bin/codelldb"), ["--port"]),
        );
    });

    it("`runtime` runs the program: runtime args, the program, then its args; `./` runtimes are the extension's", () => {
        const ext = extension("/ext/a", [
            { type: "node2", runtime: "./node", runtimeArgs: ["--inspect"], program: "/abs/adapter.js", args: ["x"] },
        ]);
        expect(platformAdapterExecutable([ext], "node2", "linux")).toEqual(
            executable(path.join("/ext/a", "node"), ["--inspect", "/abs/adapter.js", "x"]),
        );
        const plain = extension("/ext/b", [{ type: "py", runtime: "python3" }]);
        expect(platformAdapterExecutable([plain], "py", "linux")).toEqual(executable("python3", []));
    });

    it("the attributes of the current platform win over the common ones, each platform its own", () => {
        const ext = extension("/e", [
            {
                type: "t",
                program: "./common",
                args: ["common"],
                linux: { program: "./linux" },
                osx: { program: "./osx", args: ["osx"] },
                windows: { runtime: "win.exe" },
            },
        ]);
        expect(platformAdapterExecutable([ext], "t", "linux")).toEqual(
            executable(path.join("/e", "linux"), ["common"]),
        );
        expect(platformAdapterExecutable([ext], "t", "darwin")).toEqual(executable(path.join("/e", "osx"), ["osx"]));
        expect(platformAdapterExecutable([ext], "t", "win32")).toEqual(
            executable("win.exe", [path.join("/e", "common"), "common"]),
        );
    });

    it("on Windows `winx86` wins in a 32-bit process, `win` over `windows` otherwise", () => {
        const ext = extension("/e", [
            { type: "t", winx86: { program: "/x86" }, win: { program: "/win" }, windows: { program: "/windows" } },
        ]);
        vi.stubEnv("PROCESSOR_ARCHITEW6432", undefined as never);
        delete process.env.PROCESSOR_ARCHITEW6432;
        expect(platformAdapterExecutable([ext], "t", "win32")).toEqual(executable("/x86", []));
        vi.stubEnv("PROCESSOR_ARCHITEW6432", "AMD64");
        expect(platformAdapterExecutable([ext], "t", "win32")).toEqual(executable("/win", []));
        const onlyWindows = extension("/e", [{ type: "t", windows: { program: "/windows" } }]);
        expect(platformAdapterExecutable([onlyWindows], "t", "win32")).toEqual(executable("/windows", []));
    });

    it("`runtimeArgs` of the platform win, the common ones fill in; a contribution without them leaves them to the next", () => {
        const ext = extension("/e", [{ type: "t", runtimeArgs: ["--common"], linux: { runtime: "node" } }]);
        expect(platformAdapterExecutable([ext], "t", "linux")).toEqual(executable("node", ["--common"]));
        const first = extension("/a", [{ type: "t", label: "T" }]);
        const second = extension("/b", [{ type: "t", runtime: "node", runtimeArgs: ["--b"] }]);
        expect(platformAdapterExecutable([first, second], "t", "linux")).toEqual(executable("node", ["--b"]));
    });

    it("contributions of the type merge across extensions, case-insensitively: the first one wins a key", () => {
        const first = extension("/first", [{ type: "LLDB", label: "LLDB" }]);
        const second = extension("/second", [
            { type: "lldb", program: "/second/adapter", args: ["2"] },
            { type: "other", program: "/other" },
        ]);
        const third = extension("/third", [{ type: "lldb", program: "/third/adapter", args: ["3"] }]);
        expect(platformAdapterExecutable([first, second, third], "Lldb", "linux")).toEqual(
            executable("/second/adapter", ["2"]),
        );
    });

    it("no program and no runtime, an unknown type, or malformed contributions — none", () => {
        expect(platformAdapterExecutable([extension("/e", [{ type: "t", label: "T" }])], "t")).toBeUndefined();
        expect(platformAdapterExecutable([extension("/e", [{ type: "t", program: "/p" }])], "u")).toBeUndefined();
        expect(
            platformAdapterExecutable([extension("/e", "nope"), extension("/e", [null, 7, {}])], "t"),
        ).toBeUndefined();
        expect(platformAdapterExecutable([{ extensionPath: "/e", packageJSON: {} }], "t")).toBeUndefined();
    });
});

describe("mainDebugTypes and definesDebugType", () => {
    const ext = extension("/e", [
        { type: "labelled", label: "L" },
        { type: "program", program: "./p" },
        { type: "runtime", runtime: "node" },
        { type: "addition", languages: ["c"] },
    ]);

    it("main contributions are those with a label, a program or a runtime (upstream registerAllDebugTypes)", () => {
        expect(mainDebugTypes([ext, extension("/f", [{ type: "", label: "no type" }])])).toEqual([
            "labelled",
            "program",
            "runtime",
        ]);
    });

    it("only a contribution with a label defines its type", () => {
        expect(definesDebugType(ext, "labelled")).toBe(true);
        expect(definesDebugType(ext, "program")).toBe(false);
        expect(definesDebugType(ext, "addition")).toBe(false);
        expect(definesDebugType(ext, "Labelled")).toBe(false);
        expect(definesDebugType(undefined, "labelled")).toBe(false);
    });
});
