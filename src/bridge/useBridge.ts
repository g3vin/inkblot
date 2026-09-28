/**
 * useBridge.ts — subscribing to the bridge from React.
 *
 * Three hooks, and the reason there are only three: a component on the shell side
 * should either be *told* something (an event) or *ask* for it (a request), and a
 * component on the surface side should register its editor. Anything else is a
 * component reaching across the seam, which is the thing the phase exists to stop.
 */
import { useEffect, useRef, useState } from 'react'
import type { EditorTarget } from '../types'
import type { EventPayload, EventType } from './client'
import { editorRegistry, shellBridge } from './appBridge'
import type { EditorRegistration } from './editorRegistry'

/**
 * Run `handler` on every event of one kind.
 *
 * The handler is held in a ref and the subscription depends only on `type`, so a
 * caller passing an inline arrow — which every caller does — does not resubscribe on
 * each render. That is not a micro-optimization: resubscribing per render to an event
 * that fires per keystroke is a leak with a heartbeat.
 *
 * The ref is written in an effect rather than during render, which the React Compiler
 * requires and which the rest of this codebase already does (`DictationControl`'s
 * `editorRef`). The subscription therefore calls through the ref, never captures the
 * handler, and reads the current one whenever an event arrives.
 */
export function useBridgeEvent<T extends EventType>(
  type: T,
  handler: (payload: EventPayload<T>) => void
): void {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => shellBridge.on(type, (payload) => handlerRef.current?.(payload)), [type])
}

/**
 * The latest payload of one event kind, as state.
 *
 * For the components that render an event rather than react to it — the toolbar being
 * the whole reason this exists.
 *
 * The value is boxed and held as `unknown`, and the cast on the way out is an
 * assertion rather than a check. It is sound for a
 * reason narrower than the type system can express here: the box has exactly one
 * writer, the subscription for `type` just below, so what comes out is what that event
 * put in. Holding it as `EventPayload<T>` directly does not typecheck, because
 * `useState` cannot distinguish a generic payload from a `SetStateAction` updater and
 * `EventPayload<T>` stays unresolved while `T` is.
 */
export function useBridgeState<T extends EventType>(
  type: T,
  initial: EventPayload<T>
): EventPayload<T> {
  const [box, setBox] = useState<{ value: unknown }>(() => ({ value: initial }))
  useBridgeEvent(type, (payload) => setBox({ value: payload }))
  return box.value as EventPayload<T>
}

/*
 * The last payload of every event kind, for a component that mounts after the event
 * it renders was sent — the toolbar switching to a canvas's items, the inspector
 * opening on a panel. Events are not replayed to late subscribers, so without this a
 * control would show its defaults until the state next changed.
 */
const latestEvents = new Map<string, unknown>()
let recordingLatest = false
const recordLatest = () => {
  if (recordingLatest) return
  recordingLatest = true
  shellBridge.onAny((event) => { latestEvents.set(event.type, (event as { payload?: unknown }).payload) })
}
recordLatest()

/** The last payload an event kind carried, if one has been sent. */
export function latestBridgeEvent<T extends EventType>(type: T): EventPayload<T> | undefined {
  return latestEvents.get(type) as EventPayload<T> | undefined
}

/**
 * `useBridgeState`, starting from the last payload already sent rather than `initial`
 * when there is one.
 */
export function useLatestBridgeState<T extends EventType>(
  type: T,
  initial: EventPayload<T>
): EventPayload<T> {
  const [box, setBox] = useState<{ value: unknown }>(() => ({
    value: latestEvents.has(type) ? latestEvents.get(type) : initial,
  }))
  useBridgeEvent(type, (payload) => setBox({ value: payload }))
  return box.value as EventPayload<T>
}

/**
 * Announce a live editor for a target, for as long as this component is mounted.
 *
 * `registration` is read through a ref rather than depended on, because its accessors
 * are recreated on every render and re-registering on every render would churn the
 * registry for no reason. The accessors are what make that safe: the registry always
 * calls the current one, so it never hands out an editor that has been replaced.
 */
export function useRegisterEditor(
  target: EditorTarget,
  registration: EditorRegistration
): void {
  const registrationRef = useRef(registration)

  useEffect(() => {
    registrationRef.current = registration
  }, [registration])

  useEffect(() => editorRegistry.register(target, {
    getEditor: () => registrationRef.current?.getEditor() ?? null,
    getDocPath: () => registrationRef.current?.getDocPath?.() ?? null,
    getSurfaceId: () => registrationRef.current?.getSurfaceId?.() ?? null,
  }), [target])
}
