'use client'

import axios, { type AxiosInstance } from 'axios'
import { createContext, useContext, useMemo, type ReactNode } from 'react'

const defaultPath = '/api/admin/waba'
type HostOptions = { apiBase?: string; client?: AxiosInstance }
const Host = createContext<HostOptions>({})

/** Set the API route and authentication transport for a single Wabix component tree. */
export function WabaHost({ apiBase, client, children }: HostOptions & { children: ReactNode }) {
    const options = useMemo(() => ({ apiBase, client }), [apiBase, client])
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
