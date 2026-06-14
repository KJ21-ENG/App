import type {ValueOf} from 'type-fest';
import Log from '@libs/Log';
import CONST from '@src/CONST';

type CacheNameType = ValueOf<typeof CONST.CACHE_API_KEYS>;

function getStableCacheRequest(cacheName: CacheNameType, key: string): Request {
    return new Request(new URL(`${cacheName}/${encodeURIComponent(key)}`, window.location.origin).toString());
}

async function findLegacyCacheMatch(cache: Cache, key: string): Promise<Response | undefined> {
    const matchingRequest = (await cache.keys()).find((request) => {
        const url = new URL(request.url);
        return url.pathname.endsWith(`/${encodeURIComponent(key)}`) || url.pathname.endsWith(`/${key}`);
    });

    return matchingRequest ? cache.match(matchingRequest) : undefined;
}

function init() {
    // Exit early if the Cache API is not supported in the current browser.
    if (!('caches' in window)) {
        Log.warn('Cache API is not supported');
        return;
    }
    const keys = Object.values(CONST.CACHE_API_KEYS);
    for (const key of keys) {
        caches.has(key).then((isExist) => {
            if (isExist) {
                return;
            }
            caches.open(key);
        });
    }
}

function put(cacheName: CacheNameType, key: string, value: Response) {
    return caches.open(cacheName).then((cache) => cache.put(getStableCacheRequest(cacheName, key), value));
}

async function get(cacheName: CacheNameType, key: string) {
    const cache = await caches.open(cacheName);
    const stableResponse = await cache.match(getStableCacheRequest(cacheName, key));
    if (stableResponse) {
        return stableResponse;
    }

    return findLegacyCacheMatch(cache, key);
}

function remove(cacheName: CacheNameType, key: string) {
    return caches.open(cacheName).then((cache) => cache.delete(getStableCacheRequest(cacheName, key)));
}

function clear(cacheName?: CacheNameType) {
    // If a cache name is provided, delete only that key.
    if (cacheName) {
        return caches.delete(cacheName);
    }

    const keys = Object.values(CONST.CACHE_API_KEYS);
    const deletePromises = keys.map((key) => caches.delete(key));

    return Promise.all(deletePromises);
}

export default {
    init,
    put,
    get,
    remove,
    clear,
};
