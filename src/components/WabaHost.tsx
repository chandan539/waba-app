'use client'

import axios, { type AxiosError, type AxiosInstance } from 'axios'
import { createContext, useContext, useMemo, type ReactNode } from 'react'

const defaultPath = '/api/admin/waba'
type HostOptions = { apiBase?: string; client?: AxiosInstance }
const Host = createContext<HostOptions>({})

/** Admin access cookies expire in minutes. Refresh once, then retry the WhatsApp call. */
function wabaClient(): AxiosInstance {
    const client = axios.create({ withCredentials: true })
    let refreshing: Promise<unknown> | null = null
    client.interceptors.response.use(
        (response) => response,
        (error: AxiosError) => {
            const config = error.config as (AxiosError['config'] & { _retry?: boolean }) | undefined
            const url = String(config?.url || '')
            if (error.response?.status !== 401 || !config || config._retry || url.includes('/auth/refresh')) {
                return Promise.reject(error)
            }
            config._retry = true
            refreshing = refreshing || axios.post('/api/auth/refresh', {}, { withCredentials: true }).finally(() => {
                refreshing = null
            })
            return refreshing.then(() => client(config)).catch((refreshError) => {
                if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin') && window.location.pathname !== '/admin/login') {
                    window.location.href = '/admin/login'
                }
                return Promise.reject(refreshError)
            })
        },
    )
    return client
}

export function wabaErrorMessage(error: any, fallback: string) {
    const data = error?.response?.data
    if (typeof data?.error === 'string' && data.error.trim()) return data.error
    if (typeof data?.message === 'string' && data.message.trim()) return data.message
    if (typeof error?.message === 'string' && error.message.trim() && !error?.isAxiosError) return error.message
    return fallback
}

/** Set the API route and authentication transport for a single Wabix component tree. */
export function WabaHost({ apiBase, client, children }: HostOptions & { children: ReactNode }) {
    const owned = useMemo(() => client ?? wabaClient(), [client])
    const options = useMemo(() => ({ apiBase, client: owned }), [apiBase, owned])
    return <Host.Provider value={options}>{children}</Host.Provider>
}

export function useWabaApi() {
    const { apiBase = defaultPath, client = axios } = useContext(Host)
    return useMemo(() => {
        const base = apiBase.replace(/\/+$/, '')
        const url = (path: string) => base + path
        return {
            get: <T = any>(path: string, config?: Parameters<AxiosInstance['get']>[1]) => client.get<T>(url(path), config),
            post: <T = any>(path: string, data?: unknown) => client.post<T>(url(path), data),
            put: <T = any>(path: string, data?: unknown) => client.put<T>(url(path), data),
            delete: <T = any>(path: string, config?: Parameters<AxiosInstance['delete']>[1]) => client.delete<T>(url(path), config),
        }
    }, [apiBase, client])
}
