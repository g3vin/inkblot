/**
 * Installing jsdom's globals onto globalThis.
 *
 * Node 21 added a built-in `globalThis.navigator`, defined as a getter with no
 * setter — so the obvious `globalThis.navigator = dom.window.navigator` throws
 * `TypeError: Cannot set property navigator of #<Object> which has only a getter`
 * and takes the whole suite down before it asserts anything.
 *
 * Every key goes through defineProperty so the suites behave the same on Node 20
 * and Node 22+.
 */
export function installGlobals(win, keys) {
  for (const key of keys) {
    Object.defineProperty(globalThis, key, {
      value: win[key],
      writable: true,
      configurable: true,
    })
  }
}
