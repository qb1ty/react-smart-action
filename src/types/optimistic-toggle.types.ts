/**
 * Настройки для хука useOptimisticToggle
 * Позволяют подписаться на жизненный цикл асинхронного запроса.
 */

export interface OptimisticToggleOptions {
    /**
     * Вызывается пот успешном завершении асинхронного действия на сервере
     * @param newState - Новое состояние, которое было успешно сохранено
     */
    onSuccess?: (newState: boolean) => void

    /**
     * Вызывается в случае ошибки сети или отказа сервера
     * @param error - Объект ошибки, перехваченный в блоке catch
     * @param attemptedState - Состояние, которые мы пытались установить.
     */
    onError?: (error: Error, attemptedState: boolean) => void

    /**
     * Вызывается всегда после завершения запроса (как finally в промисах)
     * @param newState - Состояние, на котором завершилось действие.
     */
    onSettled?: (newState: boolean) => void
}

/**
 * Объект метаданных, возвращаемый третьим элементом в кортеже хука.
 */
export interface OptimisticToggleMeta {
    /** Флаг активного фонового запроса (true, пока выполняется асинхронная функция) */
    isPending: boolean
    /** Последняя ошибка, если сервер отклонил изменение. Возвращается к null при следующей попытке. */
    error: Error | null
}

/**
 * Строгий контракт возвращаемого значения для useOptimisticToggle
 * Кортеж [state, toggleFn, meta]
 */
export type OptimisticToggleReturn = [
    state: boolean,
    toggle: () => void,
    meta: OptimisticToggleMeta
]
