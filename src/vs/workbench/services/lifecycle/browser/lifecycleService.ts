import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { DialogService } from "../../dialogs/browser/dialogService.ts";
import { DialogServiceDIToken } from "../../dialogs/browser/dialogService.ts";

export const LifecycleServiceDIToken = token<LifecycleService>("LifecycleService");

/**
 * «Грязный» элемент участника shutdown — то, что требует подтверждения
 * пользователя перед выходом (несохранённый редактор и т.п.).
 */
export interface IShutdownDirtyItem {
    /** Имя для диалога «сохранить изменения?». */
    readonly name: string;
    /**
     * Актуален ли элемент к моменту своего диалога: пока пользователь отвечал
     * по предыдущим, вкладку могли закрыть — такой элемент пропускается.
     */
    isStillDirty(): boolean;
    /**
     * Сохранить по выбору «Save». Явный Save при выходе перезаписывает файл
     * даже при внешних изменениях — выбор пользователя не должен пропасть.
     */
    save(): Promise<unknown>;
}

/**
 * Участник shutdown-протокола (аналог vscode `onBeforeShutdown`-вето):
 * отдаёт снапшот своих «грязных» элементов. Workbench объявляет интерфейс,
 * владельцы состояния (сейчас `EditorService`) реализуют его
 * структурно и регистрируются через {@link LifecycleService.registerShutdownParticipant}.
 */
export interface IShutdownParticipant {
    collectDirty(): readonly IShutdownDirtyItem[];
}

/**
 * Жизненный цикл приложения (аналог vscode `ILifecycleService`, срез shutdown):
 * {@link requestShutdown} последовательно спрашивает про каждый «грязный» элемент
 * участников через `DialogService.confirmSave`; Cancel прерывает прощание,
 * иначе по завершении зовётся `onProceed`. Что именно случится дальше — выход
 * (`WorkbenchComponent`) или перезагрузка окна (`reloadWindowAction`) — решает
 * вызывающий: сценариев два, а протокол прощания один.
 */
export class LifecycleService {
    public static dependencies = [DialogServiceDIToken] as const;

    private participants: IShutdownParticipant[] = [];

    public constructor(private readonly dialogService: DialogService) {}

    public registerShutdownParticipant(participant: IShutdownParticipant): void {
        this.participants.push(participant);
    }

    /**
     * Запрос на прощание с сессией: без «грязных» элементов `onProceed` зовётся
     * синхронно (до первого await), иначе — после последнего подтверждения.
     * Cancel в любом диалоге оставляет приложение как есть.
     */
    public async requestShutdown(onProceed: () => void): Promise<void> {
        for (const participant of this.participants) {
            for (const item of participant.collectDirty()) {
                if (!item.isStillDirty()) continue;
                const choice = await this.dialogService.confirmSave(item.name);
                if (choice === "cancel") return;
                if (choice === "save") await item.save();
            }
        }
        onProceed();
    }
}
