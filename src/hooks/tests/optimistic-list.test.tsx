import { describe, it, expect, vi } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useOptimisticList } from "../optimistic-list.hook"

interface Todo {
    id: number
    title: string
    completed?: boolean
}

const initialTodos: Todo[] = [
    { id: 1, title: "Купить молоко", completed: false },
    { id: 2, title: "Выучить React 19", completed: true },
]

const mongoTodos = [
    { _id: "a1", title: "Задача 1" },
    { _id: "b2", title: "Задача 2" }
]

const newTodo: Todo = { id: 3, title: "Написать тесты", completed: false }
const updateTodo: Todo = { id: 1, title: "Купить кокосовое молоко", completed: true }

describe("useOptimisticList", () => {
    it(
        "Должен мгновенно добавлять элемент (add) и вызывать onSuccess при успехе",
        async () => {
            const mockOnAdd = vi.fn().mockImplementation(() => {
                return new Promise((resolve) => setTimeout(() => resolve({ success: true }), 50))
            })

            const onSuccessMock = vi.fn()

            const { result } = renderHook(() =>
                useOptimisticList(initialTodos, { onAdd: mockOnAdd, onSuccess: onSuccessMock })
            )

            expect(result.current.list.length).toBe(2)
            expect(result.current.meta.isPending).toBe(false)

            await act(async () => {
                result.current.add(newTodo)
            })

            expect(result.current.list.length).toBe(3)
            expect(result.current.list[2]).toEqual(newTodo)
            expect(result.current.meta.lastAction).toBe("add")

            await waitFor(() => {
                expect(mockOnAdd).toHaveBeenCalledWith(newTodo)
                expect(onSuccessMock).toHaveBeenCalledWith("add", { success: true })
                expect(result.current.meta.error).toBeNull()
            })
        }
    )

    it(
        "Должен мгновенно удалять элемент по ID (remove)",
        async () => {
            const mockOnRemove = vi.fn().mockImplementation(() => {
                return new Promise((resolve) => setTimeout(resolve, 50))
            })

            const { result } = renderHook(() =>
                useOptimisticList(initialTodos, { onRemove: mockOnRemove })
            )

            await act(async () => {
                result.current.remove(1)
            })

            expect(result.current.list.length).toBe(1)
            expect(result.current.list[0].id).toBe(2)

            await waitFor(() => {
                expect(mockOnRemove).toHaveBeenCalledWith(1)
            })
        }
    )

    it(
        "Должен мгновенно обновить существующий элемент (update)",
        async () => {
            const mockOnUpdate = vi.fn().mockImplementation(() => {
                return new Promise((resolve) => setTimeout(resolve, 50))
            })

            const { result } = renderHook(() =>
                useOptimisticList(initialTodos, { onUpdate: mockOnUpdate })
            )

            await act(async () => {
                result.current.update(updateTodo)
            })

            expect(result.current.list[0]).toEqual(updateTodo)
            expect(result.current.list[1].id).toBe(2)

            await waitFor(() => {
                expect(mockOnUpdate).toHaveBeenCalledWith(updateTodo)
            })
        }
    )

    it(
        "Должен автоматический восстанавливать список (Rollback) при ошибке сервера",
        async () => {
            const mockFailedRemove = vi.fn().mockImplementation(() => {
                return Promise.reject(new Error("Ошибка 403: Нет прав на удаление"))
            })

            const onErrorMock = vi.fn()

            const { result } = renderHook(() =>
                useOptimisticList(initialTodos, { onRemove: mockFailedRemove, onError: onErrorMock })
            )

            expect(result.current.list.length).toBe(2)

            await act(async () => {
                result.current.remove(2)
            })

            expect(result.current.list.length).toBe(1)

            await waitFor(() => {
                expect(result.current.list.length).toBe(2)
                expect(result.current.list[1].id).toBe(2)

                expect(result.current.meta.error).toBeInstanceOf(Error)
                expect(result.current.meta.error?.message).toBe("Ошибка 403: Нет прав на удаление")
                expect(onErrorMock).toHaveBeenCalledWith(expect.any(Error), "remove", 2)
            })
        }
    )

    it(
        "Должен корректно работать с косатомным полем идентификацию (idField)",
        async () => {
            const mockOnRemove = vi.fn().mockImplementation(() => {
                return new Promise((resolve) => setTimeout(resolve, 50))
            })

            const { result } = renderHook(() =>
                useOptimisticList(mongoTodos, { idField: "_id", onRemove: mockOnRemove })
            )

            await act(async () => {
                result.current.remove("a1")
            })

            expect(result.current.list.length).toBe(1)
            expect(result.current.list[0]._id).toBe("b2")
        }
    )
})
