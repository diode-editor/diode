import { afterEach, describe, expect, it } from "vitest";

import { Disposable } from "../../base/common/lifecycle.ts";
import type { ServiceAccessor, Token } from "../../platform/instantiation/common/diContainer.ts";
import { Container, token } from "../../platform/instantiation/common/diContainer.ts";
import {
    enableInstantiationTrace,
    resetInstantiationTrace,
} from "../../platform/instantiation/common/instantiationTrace.ts";

import type { IWorkbenchContribution, IWorkbenchContributionRegistration } from "./iWorkbenchContribution.ts";
import { WorkbenchContributionsRegistry } from "./workbenchContributionsRegistry.ts";

class FakeContribution extends Disposable implements IWorkbenchContribution {
    public disposedFlag = false;
    public override dispose(): void {
        this.disposedFlag = true;
        super.dispose();
    }
}

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

    it("afterRestored — своего перехода нет: идёт первым в переходе в eventually, раньше пачки eventually", () => {
        const eventuallyToken = { id: "eventually" } as Token<IWorkbenchContribution>;
        const afterRestoredToken = { id: "afterRestored" } as Token<IWorkbenchContribution>;
        const { accessor, resolved } = fakeAccessor(
            new Map<Token<unknown>, unknown>([
                [eventuallyToken, new FakeContribution()],
                [afterRestoredToken, new FakeContribution()],
            ]),
        );
        // Entries are in reverse of the expected order: the phase defines the order, not the list.
        const registry = new WorkbenchContributionsRegistry(accessor, [
            { token: eventuallyToken, phase: "eventually" },
            { token: afterRestoredToken, phase: "afterRestored" },
        ]);

        registry.instantiateByPhase("ready");
        registry.instantiateByPhase("restored");
        expect(resolved).toEqual([]);

        registry.instantiateByPhase("eventually");
        expect(resolved).toEqual([afterRestoredToken, eventuallyToken]);
    });

    describe("под трассой созданий", () => {
        afterEach(() => {
            resetInstantiationTrace();
        });

        it("контрибуция помечена фазой и флагом, её зависимость — фазой и родителем", () => {
            const tracer = enableInstantiationTrace();
            const DepDIToken = token<object>("Dep");
            const ContribDIToken = token<IWorkbenchContribution>("Contrib");
            class Contrib extends FakeContribution {
                public static dependencies = [DepDIToken] as const;
                public constructor(public readonly dep: object) {
                    super();
                }
            }
            const container = new Container().bind(DepDIToken, () => ({})).bind(ContribDIToken, Contrib);
            const registry = new WorkbenchContributionsRegistry(container, [
                { token: ContribDIToken, phase: "blockStartup" },
            ]);

            registry.instantiateByPhase("blockStartup");

            const entries = tracer.getEntries();
            expect(entries.map((e) => [e.id, e.requester, e.phase, e.contribution])).toEqual([
                ["Dep", "Contrib", "blockStartup", false],
                ["Contrib", "contributions:blockStartup", "blockStartup", true],
            ]);
            // An instantiation outside a phase gets neither phase nor flag, even right after one.
            const LaterDIToken = token<object>("Later");
            container.bind(LaterDIToken, () => ({})).get(LaterDIToken);
            expect(tracer.getEntries().at(-1)).toMatchObject({ id: "Later", phase: null, contribution: false });
        });

        it("уже созданная контрибуция записи не даёт и флаг не протекает дальше", () => {
            const tracer = enableInstantiationTrace();
            const ContribDIToken = token<IWorkbenchContribution>("Contrib");
            const OtherDIToken = token<object>("Other");
            const container = new Container()
                .bind(ContribDIToken, () => new FakeContribution())
                .bind(OtherDIToken, () => ({}));
            container.get(ContribDIToken);
            const registry = new WorkbenchContributionsRegistry(container, [{ token: ContribDIToken, phase: "ready" }]);

            registry.instantiateByPhase("ready");
            container.get(OtherDIToken);

            expect(tracer.getEntries().map((e) => [e.id, e.contribution, e.phase])).toEqual([
                ["Contrib", false, null],
                ["Other", false, null],
            ]);
        });
    });
});
