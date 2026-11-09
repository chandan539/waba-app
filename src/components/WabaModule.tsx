'use client'

import type { AxiosInstance } from 'axios'
import { WabaBoard } from './WabaBoard'
import { WabaHost } from './WabaHost'

/** Standalone entry point for a host application's authenticated admin page. */
export function WabaModule({ apiBase, client }: { apiBase?: string; client?: AxiosInstance } = {}) {
    return (
        <WabaHost apiBase={apiBase} client={client}>
            <WabaBoard channels />
        </WabaHost>
    )
}
