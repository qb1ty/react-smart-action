import { useCallback, useOptimistic, useState, useTransition } from "react"
import type { ActionType, ListItem, OptimisticListOptions, OptimisticListReturn } from "../types"

/**
 * Внутренний тип для описания возможных оптимистичных изменений массива.
 * Используем discriminated union (объединение с меткой type), что ts точно
 * знал, какие поля доступны ждя каждой конкретной операции
 */
type ListAction<T> =
    | { type: "add", item: T }
    | { type: "remove", id: string | number, idField: keyof T }
    | { type: "update", item: T, idField: keyof T }

/**
 * Хук для управления массивами данных (списками) с мгновенным оптимистичным обновлением UI
 * т автоматическим откатом состояния при ошибках севера.
 * 
 * @param initialList - Исходный массив элементов, полученный от сервера или из родительского пропса.
 * @param options - Настройки CRUD-обработчиков и поле идентификатора (по умолчанию "id")
 */
export const useOptimisticList =
    <T extends ListItem>(
        initialState: T[],
        options: OptimisticListOptions<T>
    ): OptimisticListReturn<T> => {
        const idField = options?.idField || ("id" as keyof T)

        const [error, setError] = useState<Error | null>(null)
        const [lastAction, setLastAction] = useState<ActionType | null>(null)

        const [isPending, startTransition] = useTransition()
        const [optimisticList, setOptimisticList] = useOptimistic<T[], ListAction<T>>(
            initialState,
            (currentList, action) => {
                switch (action.type) {
                    case "add":
                        return [...currentList, action.item]
                    case "remove":
                        return currentList.filter((item) => item[action.idField] !== action.id)
                    case "update":
                        return currentList.map((item) =>
                            item[action.idField] === action.item[action.idField] ? action.item : item
                        )
                    default:
                        return currentList
                }
            }
        )

        const clearError = useCallback(() => {
            setError(null)
        }, [])

        const add = useCallback(
            (item: T) => {
                setError(null)
                setLastAction("add")

                startTransition(async () => {
                    setOptimisticList({ type: "add", item })

                    try {
                        const result = await options?.onAdd?.(item)
                        options?.onSuccess?.("add", result)
                    } catch (err) {
                        const errorObj = err instanceof Error ? err : new Error(String(err))
                        setError(errorObj)

                        options?.onError?.(errorObj, "add", item)
                    }
                })
            },
            [options, setOptimisticList]
        )

        const remove = useCallback(
            (id: string | number) => {
                setError(null)
                setLastAction("remove")

                startTransition(async () => {
                    setOptimisticList({ type: "remove", id, idField })
                    
                    try {
                        const result = await options?.onRemove?.(id)
                        options?.onSuccess?.("remove", result)
                    } catch (err) {
                        const errorObj = err instanceof Error ? err : new Error(String(err))
                        setError(errorObj)

                        options?.onError?.(errorObj, "remove", id)
                    }
                })
            },
            [idField, options, setOptimisticList]
        )

        const update = useCallback(
            (item: T) => {
                setError(null)
                setLastAction("update")
                
                startTransition(async () => {
                    setOptimisticList({ type: "update", item, idField })

                    try {
                        const result = await options?.onUpdate?.(item)
                        options?.onSuccess?.("update", result)
                    } catch (err) {
                        const errorObj = err instanceof Error ? err : new Error(String(err))
                        setError(errorObj)

                        options?.onError?.(errorObj, "update", item)
                    }
                })
            },
            [idField, options, setOptimisticList]
        )

        return {
            list: optimisticList,
            add,
            remove,
            update,
            clearError,
            meta: {
                isPending,
                error,
                lastAction
            }
        }
    }
