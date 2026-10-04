import { describe, expect, it } from "vitest";

import { Disposable } from "../../base/common/lifecycle.ts";
import type { ServiceAccessor, Token } from "../../platform/instantiation/common/diContainer.ts";

import type { IWorkbenchContribution, IWorkbenchContributionRegistration } from "./iWorkbenchContribution.ts";
import { WorkbenchContributionsRegistry } from "./workbenchContributionsRegistry.ts";

class FakeContribution extends Disposable implements IWorkbenchContribution {
    public disposedFlag = false;
    public override dispose(): void {
        this.disposedFlag = true;
        super.dispose();
    }
}

/** Фейковый accessor: отдаёт заранее уложенные инстансы и считает резолвы. */
function fakeAccessor(instances: Map<Token<unknown>, unknown>): {
    accessor: ServiceAccessor;
    resolved: Token<unknown>[];
} {
    const resolved: Token<unknown>[] = [];
    const accessor: ServiceAccessor = {
        get: <T>(tok: Token<T>): T => {
            resolved.push(tok);
            return instances.get(tok) as T;
        },
    };
    return { accessor, resolved };
}

describe("WorkbenchContributionsRegistry", () => {
    it("instantiateByPhase резолвит только contribution'ы своей фазы", () => {
        const readyToken = { id: "restored" } as Token<IWorkbenchContribution>;
        const eventuallyToken = { id: "eventually" } as Token<IWorkbenchContribution>;
        const ready = new FakeContribution();
        const eventually = new FakeContribution();
        const { accessor, resolved } = fakeAccessor(
            new Map<Token<unknown>, unknown>([
                [readyToken, ready],
                [eventuallyToken, eventually],
            ]),
        );
        const registrations: IWorkbenchContributionRegistration[] = [
            { token: readyToken, phase: "ready" },
            { token: eventuallyToken, phase: "eventually" },
        ];
        const registry = new WorkbenchContributionsRegistry(accessor, registrations);

        registry.instantiateByPhase("ready");
        expect(resolved).toEqual([readyToken]);

        registry.instantiateByPhase("eventually");
        expect(resolved).toEqual([readyToken, eventuallyToken]);
    });

    it("blockStartup — своя пачка в порядке записей, переходы жизненного цикла её не трогают", () => {
        const firstToken = { id: "first" } as Token<IWorkbenchContribution>;
        const secondToken = { id: "second" } as Token<IWorkbenchContribution>;
        const readyToken = { id: "ready" } as Token<IWorkbenchContribution>;
        const { accessor, resolved } = fakeAccessor(
            new Map<Token<unknown>, unknown>([
                [firstToken, new FakeContribution()],
                [secondToken, new FakeContribution()],
                [readyToken, new FakeContribution()],
            ]),
        );
        const registry = new WorkbenchContributionsRegistry(accessor, [
            { token: firstToken, phase: "blockStartup" },
            { token: readyToken, phase: "ready" },
            { token: secondToken, phase: "blockStartup" },
        ]);

        registry.instantiateByPhase("blockStartup");
        expect(resolved).toEqual([firstToken, secondToken]);

        registry.instantiateByPhase("starting");
        registry.instantiateByPhase("ready");
        expect(resolved).toEqual([firstToken, secondToken, readyToken]);
    });

    it("пустая фаза ничего не резолвит", () => {
        const readyToken = { id: "restored" } as Token<IWorkbenchContribution>;
        const { accessor, resolved } = fakeAccessor(
            new Map<Token<unknown>, unknown>([[readyToken, new FakeContribution()]]),
        );
        const registry = new WorkbenchContributionsRegistry(accessor, [{ token: readyToken, phase: "ready" }]);

        registry.instantiateByPhase("eventually");

        expect(resolved).toEqual([]);
    });

    it("dispose реестра сматывает все инстанцированные contribution'ы", () => {
        const token = { id: "c" } as Token<IWorkbenchContribution>;
        const contribution = new FakeContribution();
        const { accessor } = fakeAccessor(new Map<Token<unknown>, unknown>([[token, contribution]]));
        const registry = new WorkbenchContributionsRegistry(accessor, [{ token, phase: "ready" }]);
        registry.instantiateByPhase("ready");

        registry.dispose();

        expect(contribution.disposedFlag).toBe(true);
    });
});
