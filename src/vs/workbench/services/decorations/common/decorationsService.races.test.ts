import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";

import type { IDecorationData, IDecorationsProvider } from "./decorations.ts";
import { DECORATION_CHANGE_DEBOUNCE_MS, DecorationsService } from "./decorationsService.ts";

/** A provider whose answers the test resolves by hand, in any order. */
function manualProvider(label: string) {
    const onDidChange = new Emitter<readonly Uri[] | undefined>();
    const pending: { uri: string; resolve: (data: IDecorationData | undefined) => void }[] = [];
    const provider: IDecorationsProvider = {
        label,
        onDidChange: onDidChange.event,
        provideDecorations: (uri) =>
            new Promise((resolve) => {
                pending.push({ uri: uri.toString(), resolve });
            }),
    };
    return {
        provider,
        pending,
        fire: (uris?: readonly Uri[]) => {
            onDidChange.fire(uris);
        },
    };
}

const file = Uri.file("/w/a.txt");

describe("DecorationsService — answers that arrive late", () => {
    let service: DecorationsService;

    beforeEach(() => {
        vi.useFakeTimers();
        service = new DecorationsService();
    });

    afterEach(() => {
        service.dispose();
        vi.useRealTimers();
    });

    async function settle(): Promise<void> {
        await vi.advanceTimersByTimeAsync(DECORATION_CHANGE_DEBOUNCE_MS);
    }

    it("an answer to a request superseded by fire([uri]) does not overwrite the newer answer", async () => {
        const p = manualProvider("a");
        service.registerDecorationsProvider(p.provider);
        service.getDecoration(file, false);
        p.fire([file]);
        expect(p.pending).toHaveLength(2);

        p.pending[1].resolve({ letter: "N" });
        await settle();
        p.pending[0].resolve({ letter: "O" });
        await settle();

        expect(service.getDecoration(file, false)?.badge).toBe("N");
    });

    it("an answer in flight when the provider fires undefined is not kept: the row is asked again", async () => {
        const p = manualProvider("a");
        service.registerDecorationsProvider(p.provider);
        service.getDecoration(file, false);
        p.fire(undefined);
        p.pending[0].resolve({ letter: "O" });
        await settle();

        service.getDecoration(file, false);
        expect(p.pending.length).toBeGreaterThan(1);
        p.pending[p.pending.length - 1].resolve({ letter: "N" });
        await settle();
        expect(service.getDecoration(file, false)?.badge).toBe("N");
    });

    it("an answer in flight when the provider is disposed never shows", async () => {
        const p = manualProvider("a");
        const registration = service.registerDecorationsProvider(p.provider);
        service.getDecoration(file, false);
        registration.dispose();
        p.pending[0].resolve({ letter: "O" });
        await settle();

        expect(service.getDecoration(file, false)).toBeUndefined();
    });
});
