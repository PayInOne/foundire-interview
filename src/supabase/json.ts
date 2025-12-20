export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[]

export function toJson(value: unknown): Json {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as Json
}

