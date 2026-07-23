import { describe, it, expect, vi } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useSmartAction } from "../smart-action.hook"

describe("useSmartAction", () => {
    it(
        "Должен выполнять кастомные оптимистичные обновления и вызывать onSuccess",
        async () => {
            const mockAction = vi.fn().mockImplementation(() => {
                return new Promise((resolve) => setTimeout(() => resolve("ok"), 50))
            })

            const onSuccessMock = vi.fn()

            const { result } = renderHook(() =>
                useSmartAction(10, {
                    action: mockAction,
                    optimisticUpdater: (currentState, payload: number) => currentState + payload,
                    onSuccess: onSuccessMock
                })
            )

            expect(result.current.state).toBe(10)

            await act(async () => {
                result.current.execute(5)
            })

            expect(result.current.state).toBe(15)

            await waitFor(() => {
                expect(mockAction).toHaveBeenCalledWith(5)
                expect(onSuccessMock).toHaveBeenCalledWith("ok", 5)
                expect(result.current.meta.error).toBeNull()
            })
        }
    )

    it(
        "Должен корректно отрабатывать Debounce (защитать сервер от спама)",
        async () => {
            const mockAction = vi.fn().mockImplementation(() => {
                return new Promise((resolve) => setTimeout(() => resolve("ok"), 50))
            })

            const { result } = renderHook(() =>
                useSmartAction("Начальный текст", {
                    action: mockAction,
                    debounceMs: 50,
                    optimisticUpdater: (_, newText: string) => newText
                })
            )

            await act(async () => {
                result.current.execute("Прив")
                result.current.execute("Приве")
                result.current.execute("Привет")
            })

            expect(result.current.state).toBe("Привет")

            await waitFor(() => {
                expect(mockAction).toHaveBeenCalledTimes(1)
                expect(mockAction).toHaveBeenCalledWith("Привет")
            })
        }
    )

    it(
        "Должен делать автоматические повторы (Retry), если сервер сбоит",
        async () => {
            let callCount = 0
            const mockUnstableAction = vi.fn().mockImplementation(() => {
                callCount++
                if (callCount <= 2) {
                    return Promise.reject(new Error("Сбой 500"))
                }
                return Promise.resolve("Успех с 3 попытки")
            })

            const onSuccessMock = vi.fn()

            const { result } = renderHook(() =>
                useSmartAction("статус", {
                    action: mockUnstableAction,
                    retries: 2,
                    retryDelayMs: 10,
                    optimisticUpdater: () => "обновлено",
                    onSuccess: onSuccessMock
                })
            )

            await act(async () => {
                result.current.execute("новый статус")
            })

            await waitFor(() => {
                expect(mockUnstableAction).toHaveBeenCalledTimes(3)
                expect(onSuccessMock).toHaveBeenCalledWith("Успех с 3 попытки", "новый статус")
                expect(result.current.state).toBe("обновлено")
                expect(result.current.meta.error).toBeNull()
            })
        }
    )

    it(
        "Должен откатывать state (Rollback), если все попытки Retry исчерпаны",
        async () => {
            const mockAlwaysFailingAction = vi.fn().mockImplementation(() => {
                return Promise.reject(new Error("Сервер недоступен"))
            })

            const onErrorMock = vi.fn()

            const { result } = renderHook(() =>
                useSmartAction(100, {
                    action: mockAlwaysFailingAction,
                    retries: 1,
                    retryDelayMs: 10,
                    optimisticUpdater: (state, value: number) => state + value,
                    onError: onErrorMock
                })
            )

            await act(async () => {
                result.current.execute(50)
            })

            expect(result.current.state).toBe(150)

            await waitFor(() => {
                expect(result.current.state).toBe(100)
                expect(mockAlwaysFailingAction).toHaveBeenCalledTimes(2)
                expect(result.current.meta.error).toBeInstanceOf(Error)
                expect(result.current.meta.error?.message).toBe("Сервер недоступен")
                expect(onErrorMock).toHaveBeenCalledWith(expect.any(Error), 50)
            })
        }
    )
})
