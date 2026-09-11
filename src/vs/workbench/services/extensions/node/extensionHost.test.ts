import { describe, expect, it } from "vitest";

import {
    extensionFixture,
    registerAndActivate,
    subprocessSpawnArgsForTests,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { EditorOptionsServiceAdapter } from "../../../api/browser/editorOptionsServiceAdapter.ts";
import { NULL_COMMAND_SERVICE } from "../../../api/common/iCommandService.ts";
import type {
    IActiveEditorMeta,
    IActiveEditorSelections,
    IEditorOptionsPatch,
    IEditorOptionsService,
    IEditorOptionsState,
} from "../../../api/common/iEditorOptionsService.ts";

import { ExtensionHost } from "./extensionHost.ts";

class FakeOptionsService implements IEditorOptionsService {
    public state: IEditorOptionsState | null = { tabSize: 4, insertSpaces: true };
    public patches: IEditorOptionsPatch[] = [];
    public getActiveEditorOptions(): IEditorOptionsState | null {
        return this.state;
    }
    public setActiveEditorOptions(patch: IEditorOptionsPatch): void {
        this.patches.push(patch);
        this.state = { ...(this.state ?? { tabSize: 4, insertSpaces: true }), ...patch };
    }
    public getActiveEditorFilePath(): string | null {
        return null;
    }
    public getActiveEditorMeta(): IActiveEditorMeta {
        return { uri: null, languageId: null, isDirty: false, encoding: null, eol: null, selection: null };
    }
    public onActiveEditorChanged(_cb: (meta: IActiveEditorMeta) => void): { dispose(): void } {
        return { dispose: () => {} };
    }
    public onActiveEditorSelectionChanged(_cb: (selections: IActiveEditorSelections) => void): { dispose(): void } {
        return { dispose: () => {} };
    }
    public setActiveEditorSelections(): void {}
    public applyActiveEditorEdits(): boolean {
        return false;
    }
    public applyWorkspaceEdit(): boolean {
        return false;
    }
}

function createHost(svc: IEditorOptionsService): ExtensionHost {
    return new ExtensionHost(svc, NULL_COMMAND_SERVICE, { spawnArgs: subprocessSpawnArgsForTests() });
}

describe("ExtensionHost (subprocess)", () => {
    it("registerExtension активирует extension через subprocess", async () => {
        const svc = new FakeOptionsService();
        const host = createHost(svc);
        await registerAndActivate(host, extensionFixture("noop-a", "noopExtension.cjs"));
        expect(host.extensionCount).toBe(1);
        expect(host.hasExtension("noop-a")).toBe(true);
        host.dispose();
        await settle(100);
    });

    it("отклоняет повторную регистрацию того же id", async () => {
        const svc = new FakeOptionsService();
        const host = createHost(svc);
        const reg = extensionFixture("dup", "noopExtension.cjs");
        host.registerExtension(reg);
        expect(() => host.registerExtension(reg)).toThrow(/already registered/);
        host.dispose();
        await settle(100);
    });

    it("после dispose registerExtension бросает", async () => {
        const svc = new FakeOptionsService();
        const host = createHost(svc);
        host.dispose();
        expect(() => host.registerExtension(extensionFixture("late", "noopExtension.cjs"))).toThrow(/disposed/);
    });

    it("onFoldingProvidersChanged: подписка снимается по dispose (идемпотентно)", () => {
        const host = createHost(new FakeOptionsService());
        let fired = 0;
        const sub = host.onFoldingProvidersChanged(() => {
            fired++;
        });
        sub.dispose();
        sub.dispose(); // повторный dispose безопасен (idx < 0)
        expect(fired).toBe(0);
        host.dispose();
    });

    it("unregisterExtension убирает конкретное расширение", async () => {
        const svc = new FakeOptionsService();
        const host = createHost(svc);
        await registerAndActivate(host, extensionFixture("x", "noopExtension.cjs"));
        await registerAndActivate(host, extensionFixture("y", "noopExtension.cjs"));
        expect(host.extensionCount).toBe(2);
        await host.unregisterExtension("x");
        expect(host.extensionCount).toBe(1);
        expect(host.hasExtension("y")).toBe(true);
        host.dispose();
        await settle(100);
    });
});

describe("EditorOptionsServiceAdapter", () => {
    it("возвращает null когда нет активного редактора", () => {
        const adapter = new EditorOptionsServiceAdapter({
            getActiveTabEditor: () => null,
        } as never);
        expect(adapter.getActiveEditorOptions()).toBeNull();
        adapter.setActiveEditorOptions({ tabSize: 2 }); // не должно бросать
    });
});
