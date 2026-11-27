import { useSyncExternalStore } from 'react'
import { connection, onConnectionChange, type Connection } from '../../api/connection'

/** 지금 연결이 있는지(api/connection, 00-common 4.3). 바뀌면 다시 그린다. */
export function useConnection(): Connection {
  return useSyncExternalStore(onConnectionChange, connection)
}
