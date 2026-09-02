import NodeCache from 'node-cache';

// Mirrors GAS's CacheService.getScriptCache(): values are put with a TTL (seconds)
// and read back as-is. Since this now runs inside one long-lived Node process
// (rather than being shared across stateless GAS executions), a single
// in-process cache is sufficient - it does not survive a process restart.
const cache = new NodeCache({ checkperiod: 60 });

const DEFAULT_TTL_SEC = 600;

export function makeKeyCache(key, value, ttlSec) {
  if (value !== undefined) {
    put(key, value, ttlSec);
  }
  return {
    get: () => get(key),
    put: (v, sec) => put(key, v, sec),
    remove: () => cache.del(key),
  };
}

export function makeCache() {
  return { get, put, remove: (key) => cache.del(key) };
}

function get(key) {
  const value = cache.get(key);
  return value === undefined ? null : value;
}

function put(key, value, ttlSec) {
  cache.set(key, value, ttlSec === undefined ? DEFAULT_TTL_SEC : ttlSec);
  return value;
}
