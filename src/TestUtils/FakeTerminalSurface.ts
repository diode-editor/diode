import { FakeTerminalSurface as EngineFakeTerminalSurface } from "@tuidom/testing/FakeTerminalSurface";

export type { FakeCellOptions } from "@tuidom/testing/FakeTerminalSurface";

/**
 * Фейк сессии встроенного терминала: поверхность из `@tuidom/testing` плюс
 * запущенный шелл и его pid (`ITerminalSession.shell`/`pid` — понятия редактора, не движка).
 */
export class FakeTerminalSurface extends EngineFakeTerminalSurface {
    /** Pid «процесса шелла» (у настоящей сессии он есть всегда). */
    public readonly pid: number | undefined;

    public constructor(
        public readonly shell = "/bin/bash",
        pid?: number,
    ) {
        super();
        this.pid = pid;
    }
}
