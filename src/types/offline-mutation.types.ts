import { QueueItem, SyncError } from "./offline-mutation-db.types"

/**
 * Статусы фонового процесса.
 */
export type SyncStatus =
    | "idle"
    | "syncing"
    | "paused_network"
    | "paused_conflict"

/**
 * Методы для ручного управления фоновой очередью из UI компонентов
 */
export interface QueueControls {
    /** Удаляет конкретную зависшую задачу по ее ID */
    removeTask: (taskId: string) => void
    /** Полностью очищает очередь для текущего mutationKey */
    clearQueue: () => void
    /** Принудительно пробуждает Sync Worker */
    resumeSync: () => void
}

/**
 * Конифигурация для повторных попыток отправки (Exponential Backoff).
 */
export interface RetryConfig {
    /** Максимальное количество попыток (по умолчанию Infinity) */
    maxRetries?: number
    /** Базовая задержка между попытками в миллисекундах (по умолчанию 1000) */
    baseDelayMs?: number
    /** Максимальная задержка между попытками (по умолчанию 30000) */
    maxDelayMs?: number
}

/**
 * Главный объект настроек
 */
export interface OfflineMutationOptions<State, Payload, ServerResponse = unknown> {
    /** Уникальный ключ очереди для IndexedDB. Гарантирует изоляцию от других хуков. */
    mutationKey: string
    /** Асинхронная функция, выполняющая реальный запрос к серверу (Server action, axios, fetch) */
    action: (payload: Payload) => Promise<ServerResponse>
    /** Функция мгновенного (оптимистичного) обновления UI до ответа сервера */
    optimisticUpdater?: (currentState: State, payload: Payload) => State
    /** Позволяет распарсить ошибку от backend и вернуть стандартизированный SyncError */
    categorizeError?: (error: unknown) => SyncError
    /** Предикат: должна ли данная ошибка класться в оффлайн-очередь (как пример класть в очередь 404 ошибку бесмысленно) */
    shouldQueueError?: (error?: unknown) => boolean
    /** Функция дедупликации: если возвращает true, новая мутация перезапишет старую, не плодя дубли */
    squash?: (prevPayload: Payload, nextPayload: Payload) => boolean
    /** Вызывается перед отправкой зависшей задачи. Идеально для инъекции свежего JWT */
    onPrepare?: (payload: Payload) => Promise<Payload> | Payload
    /** Calback успешной синхронизации */
    onSyncSuccess?: (response: ServerResponse, payload: Payload) => void
    /** Callback критического конфликта. Очередь останавливается до решения разработчика/пользователя */
    onConflict?: (error: SyncError, payload: Payload, controls: QueueControls) => void
    /** Callback окончательного провала (исчерпаны retry). Возвращает state к стабильному */
    onRollback?: (error: SyncError, restoredState: State) => void
    /** Настройки тайминга для повторных попыток отправки */
    retryConfig?: RetryConfig
}

/**
 * Метаданные о текущем состоянии синхронизации для отрисовки красивых индикаторов в UI.
 */
export interface OfflineMutationMeta<Payload> {
    syncStatus: SyncStatus
    queue: QueueItem<Payload>[]
    isOffline: boolean
    error: SyncError | null
}

/**
 * Итогвый объект, который возвращает хук useOfflineMutation
 */
export interface OfflineMutationReturn<State, Payload> extends QueueControls {
    state: State
    execute: (payload: Payload) => void
    meta: OfflineMutationMeta<Payload>
}