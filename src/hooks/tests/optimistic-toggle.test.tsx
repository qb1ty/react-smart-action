import { describe, it, expect, vi } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useOptimisticToggle } from "../optimistic-toggle.hook"

describe("useOptimisticToggle", () => {
    it(
        "Должен мгновенно переключить состояние (оптимистично) и сохранять его при успехе сервера",
        async () => {
            const mockServerAction = vi.fn().mockImplementation(() => {
                return new Promise((resolve) => setTimeout(resolve, 50))
            })

            const onSuccessMock = vi.fn()

            const { result } = renderHook(() =>
                useOptimisticToggle(false, mockServerAction, { onSuccess: onSuccessMock })
            )

            expect(result.current[0]).toBe(false)
            expect(result.current[2].isPending).toBe(false)

            await act(async () => {
                result.current[1]()
            })

            expect(result.current[0]).toBe(true)

            await waitFor(() => {
                expect(mockServerAction).toHaveBeenCalledWith(true)
                expect(onSuccessMock).toHaveBeenCalledWith(true)
                expect(result.current[2].error).toBeNull()
            })
        }
    )

    it(
        "Должен автоматически откатывать состояние (Rollback), если сервер вернул ошибку",
        async () => {
            const mockFailedServerAction = vi.fn().mockImplementation(() => {
                return Promise.reject(new Error("Ошибка сети 500"))
            })

            const onErrorMock = vi.fn()

            const { result } = renderHook(() =>
                useOptimisticToggle(true, mockFailedServerAction, { onError: onErrorMock })
            )

            expect(result.current[0]).toBe(true)

            await act(async () => {
                result.current[1]()
            })

            await waitFor(() => {
                expect(result.current[0]).toBe(true)
                expect(result.current[2].error).toBeInstanceOf(Error)
                expect(result.current[2].error?.message).toBe("Ошибка сети 500")
                expect(onErrorMock).toHaveBeenCalledWith(expect.any(Error), false)
            })
        }
    )
})