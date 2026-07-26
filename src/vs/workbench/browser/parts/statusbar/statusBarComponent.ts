import type { StatusBarItem } from "../../../../../../tuidom/ui/statusbar/statusBarElement.ts";
import { StatusBarElement } from "../../../../../../tuidom/ui/statusbar/statusBarElement.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";
import { ThemedComponent } from "../../component.ts";

export const StatusBarComponentDIToken = token<StatusBarComponent>("StatusBarComponent");

/**
 * Компонент статус-бара: владеет {@link StatusBarElement} и отражает в нём
 * записи {@link StatusBarService} (перерисовка по `onDidChangeEntries`).
 * Про поставщиков записей ничего не знает — сегменты публикуют
 * contribution-сервисы (`EditorStatusContribution` и др.).
 */
export class StatusBarComponent extends ThemedComponent {
    public static dependencies = [StatusBarServiceDIToken, ThemeServiceDIToken] as const;

    public readonly view: StatusBarElement;

    public constructor(
        private readonly statusBarService: StatusBarService,
        themeService: ThemeService,
    ) {
        super(themeService);
        this.view = new StatusBarElement();
        this.view.id = "statusBar";
        this.register(
            this.statusBarService.onDidChangeEntries(() => {
                this.renderEntries();
            }),
        );
        this.renderEntries();
        this.initStyles();
    }

    private renderEntries(): void {
        this.view.setItems(
            this.statusBarService.entries().map((entry) => {
                const item: StatusBarItem = { text: entry.text };
                if (entry.alignment === "right") item.align = "right";
                if (entry.onClick !== undefined) item.onClick = entry.onClick;
                return item;
            }),
        );
    }

    protected updateStyles(): void {
        const bg = this.theme.getRequiredColor("statusBar.background");
        const fg = this.theme.getRequiredColor("statusBar.foreground");
        this.view.style = { fg, bg };
    }
}
