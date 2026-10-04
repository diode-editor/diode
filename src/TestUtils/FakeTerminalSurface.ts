import { FakeTerminalSurface as EngineFakeTerminalSurface } from "@tuidom/testing/FakeTerminalSurface";

export type { FakeCellOptions } from "@tuidom/testing/FakeTerminalSurface";

/**
 * Фейк сессии встроенного терминала: поверхность из `@tuidom/testing` плюс
 * запущенный шелл (`ITerminalSession.shell` — понятие редактора, не движка).
 */
export class FakeTerminalSurface extends EngineFakeTerminalSurface {
    public constructor(public readonly shell = "/bin/bash") {
        super();
    }
}
