import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useSmartSocket } from "../smart-socket.hook"

class MockWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    static instances: MockWebSocket[] = []
    url: string
    readyState: number = MockWebSocket.CONNECTING
    onopen: ((event: any) => void) | null = null
    onclose: ((event: any) => void) | null = null
    onmessage: ((event: any) => void) | null = null
    onerror: ((event: any) => void) | null = null
    sendMock = vi.fn()
    closeMock = vi.fn()

    constructor(url: string) {
        this.url = url
        MockWebSocket.instances.push(this)
        setTimeout(() => {
            this.readyState = MockWebSocket.OPEN
            this.onopen?.({})
        }, 0)
    }

    send(data: any) {
        this.sendMock(data)
    }

    close() {
        this.readyState = MockWebSocket.CLOSED
        this.closeMock()
        this.onclose?.({})
    }

    receiveMessage(data: any) {
        this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) })
    }
}

describe("useSmartSocket", () => {
    beforeEach(() => {
        MockWebSocket.instances = []
        vi.stubGlobal("WebSocket", MockWebSocket)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it(
        "Должен открывать соединение, делать оптимистичное обновление и отправлять данные в сокет",
        async () => {
            const { result } = renderHook(() =>
                useSmartSocket("Начальный стейт", {
                    url: "wss://test.com",
                    optimisticUpdater: (_, newText: string) => newText
                })
            )

            await waitFor(() => {
                expect(result.current.meta.status).toBe("OPEN")
            })

            const activeSocket = MockWebSocket.instances[0]

            await act(async () => {
                result.current.emit("Оптимистичный привет")
            })

            expect(result.current.state).toBe("Оптимистичный привет")
            expect(result.current.meta.isOptimistic).toBe(true)
            expect(activeSocket.sendMock).toHaveBeenCalledWith('"Оптимистичный привет"')
        }
    )

    it(
        "Должен откатывать UI к Стабильному Якорю, если сервер вернул ошибку",
        async () => {
            const { result } = renderHook(() =>
                useSmartSocket("Стабильное состояние", {
                    url: "wss://test.com",
                    optimisticUpdater: (_, newText: string) => newText,
                    onMessage: (res: any, { rollback, confirm }) => {
                        if (res.status === "error") {
                            rollback(res.message)
                        } else {
                            confirm()
                        }
                    }
                })
            )

            await waitFor(() => {
                expect(result.current.meta.status).toBe("OPEN")
            })

            const activeSocket = MockWebSocket.instances[0]

            await act(async () => {
                result.current.emit("Ошибочное состояние")
            })

            expect(result.current.state).toBe("Ошибочное состояние")

            await act(async () => {
                activeSocket.receiveMessage({ status: "error", message: "Сбой на сервере" })
            })

            await waitFor(() => {
                expect(result.current.state).toBe("Стабильное состояние")
                expect(result.current.meta.isOptimistic).toBe(false)
                expect(result.current.meta.error?.message).toBe("Сбой на сервере")
            })
        }
    )

    it(
        "Должен автоматически откатывать UI, если сервер не подтвердил операцию за ackTimeoutMs (TTL)",
        async () => {
            const onAckTimeoutMock = vi.fn()

            const { result } = renderHook(() =>
                useSmartSocket<number, number>(100, {
                    url: "wss://test.com",
                    ackTimeoutMs: 50,
                    optimisticUpdater: (state, payload: number) => state + payload,
                    onAckTimeout: onAckTimeoutMock
                })
            )

            await waitFor(() => {
                expect(result.current.meta.status).toBe("OPEN")
            })

            await act(async () => {
                result.current.emit(50)
            })

            expect(result.current.state).toBe(150)
            expect(result.current.meta.isOptimistic).toBe(true)

            await waitFor(() => {
                expect(result.current.state).toBe(100)
                expect(result.current.meta.isOptimistic).toBe(false)
                expect(onAckTimeoutMock).toHaveBeenCalledTimes(1)
                expect(result.current.meta.error?.message).toContain("ACK Timeout")
            })
        }
    )

    it(
        "Должен выполнять автоматический Resync после успешного восстановления соединения",
        async () => {
            const onResyncMock = vi.fn().mockImplementation(async ({ updateState }) => {
                updateState("Синхронизированные данные")
            })

            const { result } = renderHook(() =>
                useSmartSocket("Старые данные", {
                    url: "wss://test.com",
                    reconnect: true,
                    reconnectIntervalMs: 10,
                    resyncOnReconnect: true,
                    onResync: onResyncMock
                })
            )

            await waitFor(() => {
                expect(result.current.meta.status).toBe("OPEN")
            })

            const firstSocket = MockWebSocket.instances[0]

            await act(async () => {
                firstSocket.close()
            })

            await waitFor(() => {
                expect(MockWebSocket.instances.length).toBe(2)
                expect(result.current.meta.status).toBe("OPEN")
            })

            await waitFor(() => {
                expect(onResyncMock).toHaveBeenCalledTimes(1)
                expect(result.current.state).toBe("Синхронизированные данные")
            })
        }
    )
})