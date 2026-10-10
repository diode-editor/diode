import { FakeTerminalSurface as EngineFakeTerminalSurface } from "@tuidom/testing/FakeTerminalSurface";

import { Emitter } from "../vs/base/common/event.ts";
import type { ITerminalRelaunchOptions } from "../vs/workbench/contrib/terminal/common/terminalSessionFactory.ts";

export type { FakeCellOptions } from "@tuidom/testing/FakeTerminalSurface";

/**
 * Фейк сессии встроенного терминала: поверхность из `@tuidom/testing` плюс
 * запущенный шелл и его pid (`ITerminalSession.shell`/`pid` — понятия редактора, не движка).
 * Перезапуск процесса на месте копит опции в `relaunches`, напечатанное в
 * эмулятор — в `printed`, последние 16 ANSI-цветов — в `ansiColors`; ввод
 * после выхода не пишется, а будит `onDidInputAfterExit`, как у настоящей сессии.
 */
export class FakeTerminalSurface extends EngineFakeTerminalSurface {
    /** Pid «процесса шелла» (у настоящей сессии он есть всегда). */
    public pid: number | undefined;
    public readonly relaunches: ITerminalRelaunchOptions[] = [];
    public readonly printed: string[] = [];
    /** Последние заданные 16 ANSI-цветов; `undefined` — не задавались. */
    public ansiColors: readonly number[] | undefined;
    private readonly inputAfterExit = new Emitter<void>();
    public readonly onDidInputAfterExit = this.inputAfterExit.event;

    public constructor(
        public shell = "/bin/bash",
        pid?: number,
    ) {
        super();
        this.pid = pid;
    }

    public override write(data: string): void {
        if (this.isExited) {
            this.inputAfterExit.fire();
            return;
        }
        super.write(data);
    }

    public relaunch(options: ITerminalRelaunchOptions): void {
        this.relaunches.push(options);
        this.isExited = false;
    }

    public printMessage(text: string): void {
        this.printed.push(text);
    }

    public setAnsiColors(ansi: readonly number[]): void {
        this.ansiColors = ansi;
    }
}
