type ReplaceableValue = Record<string, unknown> | unknown[] | string | number | boolean | undefined | null;

/**
 * @param target the object or value to transform
 * @param oldVal the value to search for
 * @param newVal the replacement value
 */
function deepReplaceKeysAndValues(target: Record<string, unknown>, oldVal: string, newVal: string): Record<string, unknown>;
function deepReplaceKeysAndValues(target: Record<string, unknown> | undefined, oldVal: string, newVal: string): Record<string, unknown> | undefined;
function deepReplaceKeysAndValues(target: unknown[], oldVal: string, newVal: string): unknown[];
function deepReplaceKeysAndValues(target: string, oldVal: string, newVal: string): string;
function deepReplaceKeysAndValues<T extends number | boolean | undefined | null>(target: T, oldVal: string, newVal: string): T;
function deepReplaceKeysAndValues(target: ReplaceableValue, oldVal: string, newVal: string): ReplaceableValue;
function deepReplaceKeysAndValues(target: ReplaceableValue, oldVal: string, newVal: string): unknown {
    return replaceKeysAndValues(target, oldVal, newVal);
}

function replaceKeysAndValues(target: unknown, oldVal: string, newVal: string): unknown {
    if (!target) {
        return target;
    }

    if (typeof target === 'string') {
        return target.replace(oldVal, newVal);
    }

    if (typeof target !== 'object') {
        return target;
    }

    if (Array.isArray(target)) {
        return target.map((item) => replaceKeysAndValues(item, oldVal, newVal));
    }

    const newObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(target)) {
        const newKey = key.replace(oldVal, newVal);

        if (val instanceof File || val instanceof Blob) {
            newObj[newKey] = val;
            continue;
        }

        if (typeof val === 'object') {
            newObj[newKey] = replaceKeysAndValues(val, oldVal, newVal);
            continue;
        }

        if (val === oldVal) {
            newObj[newKey] = newVal;
            continue;
        }

        if (typeof val === 'string') {
            newObj[newKey] = val.replace(oldVal, newVal);
            continue;
        }

        newObj[newKey] = val;
    }

    return newObj;
}

export default deepReplaceKeysAndValues;

export type {ReplaceableValue};
