/**
 * Базовое требование к элементу списка: он должен иметь уникальный идентификатор
 * По умолчанию ожидаем поле id, но возможность настроить кастомный ключ.
 */
export type ListItem = Record<string, any>

/**
 * Типы последней выполненной операции
 */
export type ActionType = "add" | "remove" | "update"

/**
 * Настройки для хука useOptimisticList.
 * Принимает асинхронные обработчики для каждой CRUD-операции.
 */
export interface OptimisticListOptions<T extends ListItem> {
    /** Асинхронная функция для добавления нового элемента на сервере */
    onAdd?: (item: T) => Promise<unknown> | void
    /** Асинхронная функция для удаления элемента на сервере по ID */
    onRemove?: (id: string | number) => Promise<unknown> | void
    /** Асинхронаня функция для обновления элемента на сервере */
    onUpdate?: (item: T) => Promise<unknown> | void

    /**
     * Название свойства, которые используется как уникальный ID (по умолчанию id)
     * Например, если база данных возвращает "_id" или "uuid".
     */
    idField?: keyof T

    /** Глобальный обработчик ошибок для любой из операции */
    onError?: (error: Error, actionType: ActionType, itemsOrId: any) => void
    /** Обработчик успешного завершения любой операции */
    onSuccess?: (actionType: ActionType, result: unknown) => void
}

/**
 * Метаданные состояние асинхронных операций списка.
 */
export interface OptimisticListMeta {
    /** Флаг выполнения фонового запроса (добавления, удаление или обновление) */
    isPending: boolean
    /** Последняя возникшая ошибка */
    error: Error | null
    /** Тип последней выполняемой операции (удобно для показа точечных спиннеров) */
    lastAction: ActionType | null
}

/**
 * Готовый набор методов и данных, возвращаемый хуком.
 */
export interface OptimisticListReturn<T extends ListItem> {
    /** Актуальный (или оптимистично обновленный) массив элементов */
    list: T[]
    /** Мгновенно добавляет элемент в конец (или начало) списка и отправляет запрос на сервер */
    add: (item: T) => void
    /** Мгновенно удаляет элемент из списка по его ID и отправляет запрос на сервер */
    remove: (id: string | number) => void
    /** Мгновенно обновляет элемент из списка (находя его по ID) и отправляет запрос на сервер */
    update: (item: T) => void
    /** Принудительный сброс ошибок в метаданных */
    clearError: () => void
    /** Состояние фоновых процессов и ошибок */
    meta: OptimisticListMeta
}