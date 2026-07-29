/**
 * Точные причины сбоя при попытке синхронизации с сервером.
 * Позволяет разработчику гибко отрисовать UI (отличить упавший сервер от слабого интерента).
 */
export type SyncErrorReason =
    | "offline"
    | "timeout"
    | "server_error"
    | "client_error"
    | "conflict"
    | "unknown"

/**
 * Расширенный объект ошибки, который хук сохраняет в IndexedDB и возвращает в UI.
 */
export interface SyncError extends Error {
    /** Категория ошибки для удобной программной обработки */
    reason: SyncErrorReason
    /** HTTP статус код ответа сервера */
    statusCode?: number
    /** Оригинальный объект ошибки для глубокого debug */
    rawError?: unknown
}

/**
 * Возможные статусы задачи, находящейся в локальной очереди IndexedDB.
 */
export type QueueItemStatus =
    | "queued"
    | "syncing"
    | "failed"
    | "paused_conflict"

/**
 * Единица данных (транзакция), которая хранится в IndexedDB до успешного подтверждения сервером.
 */
export interface QueueItem<Payload> {
    /** Уникальный идентификатор задач (UUID) */
    id: string
    /**Уникальный ключ очереди ("todo-updates"), чтобы хуки не мешали друг-другу */
    mutationKey: string
    /** Полезная нагрузка - сами данные, которые мы пытались отправить на сервер */
    payload: Payload
    /** Unix-timestamp создания задачи. Гарантирует строгий порядок выполнения FIFO */
    timestamp: number
    /** Текущее состояние задачи в пайплайне синхронизации */
    status: QueueItemStatus
    /** Количество неудачных попыток отправки (используется для расчета задержки retry) */
    retryCount: number
    /** Детали последнего сбоя, чтобы показать для пользователя причину */
    lastError?: SyncError | null
}