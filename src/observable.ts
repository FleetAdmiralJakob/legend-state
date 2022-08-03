import { delim, getChildNode, getNodeValue, getParentNode, symbolGet, symbolID, symbolIsObservable } from './globals';
import { isArray, isFunction, isPrimitive, isSymbol } from './is';
import { observableBatcher, observableBatcherNotify } from './observableBatcher';
import {
    Observable,
    ObservableOrPrimitive,
    ObservablePrimitive,
    ObservableWrapper,
    ProxyValue,
} from './observableInterfaces';
import { onChange, onChangeShallow, onEquals, onHasValue, onTrue } from './on';
import state from './state';

let lastAccessedNode: ProxyValue;
let lastAccessedPrimitive: string;
let inSetFn = false;

const ArrayModifiers = new Set([
    'copyWithin',
    'fill',
    'from',
    'pop',
    'push',
    'reverse',
    'shift',
    'sort',
    'splice',
    'unshift',
]);
const ArrayLoopers = new Set<keyof Array<any>>(['every', 'some', 'filter', 'reduce', 'reduceRight', 'forEach', 'map']);

const objectFnsProxy = new Map<string, Function>([
    ['set', set],
    ['setProp', setProp],
    ['onChange', onChange],
    ['onChangeShallow', onChangeShallow],
    ['onEquals', onEquals],
    ['onHasValue', onHasValue],
    ['onTrue', onTrue],
    ['prop', prop],
    ['assign', assign],
    ['delete', deleteFnProxy],
]);

// Override primitives
const wrapFn = (fn: Function) =>
    function (...args: any) {
        if (lastAccessedNode && lastAccessedPrimitive) {
            const node: ProxyValue = getChildNode(lastAccessedNode, lastAccessedPrimitive);
            if (getNodeValue(node) === this) {
                return fn(node, ...args);
            }
        }
    };
const toOverride = [Number, Boolean, String];
objectFnsProxy.forEach((fn, key) => {
    toOverride.forEach((override) => (override.prototype[key] = wrapFn(fn)));
});

function collectionSetter(node: ProxyValue, target: any, prop: string, ...args: any[]) {
    const prevValue = (isArray(target) && target.slice()) || target;

    const ret = (target[prop] as Function).apply(target, args);

    if (node) {
        const { parent, key } = getParentNode(node);
        if (parent) {
            const parentValue = getNodeValue(parent);

            // Set the object to the previous value first
            parentValue[key] = prevValue;

            // Then set with the new value so it notifies with the correct prevValue
            setProp(parent, key, target);
        }
    }

    // Return the original value
    return ret;
}

function updateNodes(parent: ProxyValue, obj: Record<any, any>, prevValue?: any) {
    const isArr = isArray(obj);
    // If array it's faster to just use the array
    const keys = isArr ? obj : Object.keys(obj);
    const length = keys.length;

    for (let i = 0; i < length; i++) {
        const key = isArr ? i : keys[i];
        const value = obj[key];
        const prev = prevValue?.[key];

        if (!isArr && prevValue && value !== prev) {
            const isObj = !isPrimitive(value);

            const child: ProxyValue = getChildNode(parent, key);
            // If object iterate through its children
            if (isObj) {
                updateNodes(child, value, prev);
            }

            // Notify for this child if this element is different and it has listeners
            // But do not notify child if the parent is an array - the array's listener will cover it
            const doNotify = child.root.listenerMap.has(child.path);
            if (doNotify) {
                _notify(child, value, [], value, prev, 0);
            }
        }
    }
}

function createProxy(node: ProxyValue) {
    const proxy = new Proxy<ProxyValue>(node, proxyHandler);
    node.root.proxies.set(node.path, proxy);
    return proxy;
}

const descriptorNotEnumerable: PropertyDescriptor = {
    enumerable: false,
    configurable: false,
};

const proxyHandler: ProxyHandler<any> = {
    get(target: ProxyValue, p: any) {
        if (p === symbolIsObservable) {
            return true;
        }

        const node = target;
        const fn = objectFnsProxy.get(p);
        if (fn) {
            return (a, b, c) => fn(node, a, b, c);
        }

        let value = getNodeValue(node);
        const vProp = value[p];
        if (p === symbolGet || p === 'get') {
            if (node.root.isPrimitive) {
                value = value.current;
            }
            if (state.isTracking) {
                state.updateTracking(node, value);
            }
            return p === 'get' ? () => value : value;
        }
        if (isSymbol(p)) {
            return vProp;
        }
        if (isFunction(vProp)) {
            if (isArray(value)) {
                if (ArrayModifiers.has(p)) {
                    return (...args) => collectionSetter(node, value, p, ...args);
                } else if (ArrayLoopers.has(p)) {
                    const arr = [];
                    for (let i = 0; i < value.length; i++) {
                        arr.push(prop(node, i));
                    }
                    return vProp.bind(arr);
                }
            }
            return vProp.bind(value);
        }
        if (isPrimitive(vProp)) {
            lastAccessedNode = node;
            lastAccessedPrimitive = p;
            if (state.isTracking) {
                state.updateTracking(getChildNode(node, p), value);
            }
            return vProp;
        }

        const path = target.path + delim + p;
        let proxy = node.root.proxies.get(path);
        if (!proxy) {
            proxy = createProxy(getChildNode(target, p));
        }
        return proxy;
    },
    // Forward all proxy properties to the target's value
    getPrototypeOf(target) {
        const value = getNodeValue(target);
        return Reflect.getPrototypeOf(value);
    },
    ownKeys(target) {
        const value = getNodeValue(target);
        const keys = Reflect.ownKeys(value);
        if (isArray(value)) {
            if (keys[keys.length - 1] === 'length') {
                keys.splice(keys.length - 1, 1);
            }
        }
        return keys;
    },
    getOwnPropertyDescriptor(target, p) {
        if (p === symbolID) {
            return descriptorNotEnumerable;
        }

        const value = getNodeValue(target);
        return Reflect.getOwnPropertyDescriptor(value, p);
    },
    set(target, prop, value) {
        // If this assignment comes from within an observable function it's allowed
        if (inSetFn) {
            Reflect.set(target, prop, value);
            return true;
        } else {
            return false;
        }
    },
    deleteProperty(target, prop) {
        // If this delete comes from within an observable function it's allowed
        if (inSetFn) {
            Reflect.deleteProperty(target, prop);
            return true;
        } else {
            return false;
        }
    },
    has(target, prop) {
        const value = getNodeValue(target);
        return Reflect.has(value, prop);
    },
};

function set(node: ProxyValue, newValue: any) {
    if (node.root.isPrimitive) {
        return setProp(node, 'current', newValue);
    } else {
        const { parent, key } = getParentNode(node);
        return setProp(parent, key, newValue);
    }
}

function setProp(node: ProxyValue, key: string | number, newValue?: any) {
    newValue = newValue?.[symbolGet] ?? newValue;

    const isPrim = isPrimitive(newValue);

    if (!key && !node.path.includes(delim)) {
        return assign(node, newValue);
    }

    inSetFn = true;

    const childNode = getChildNode(node, key);

    let parentValue = getNodeValue(node);

    // Save the previous value first
    const prevValue = parentValue[key];

    // Save the new value
    parentValue[key] = newValue;

    // If new value is an object or array update notify down the tree
    if (!isPrim) {
        updateNodes(childNode, newValue, prevValue);
    }

    // Notify for this element if it's an object or it's changed
    if (!isPrim || newValue !== prevValue) {
        notify(node.root.isPrimitive ? node : childNode, newValue, prevValue, prevValue === undefined ? -1 : 0);
    }

    inSetFn = false;

    return newValue;
}

function _notify(
    node: ProxyValue,
    value: any,
    path: (string | number)[],
    valueAtPath: any,
    prevAtPath: any,
    level: number
) {
    const listeners = node.root.listenerMap.get(node.path);
    // Notify all listeners
    if (listeners) {
        let getPrev;
        for (let listener of listeners) {
            // Notify if listener is not shallow or if this is the first level
            if (!listener.shallow || level <= 0) {
                if (!getPrev) {
                    getPrev = createPreviousHandler(value, path, prevAtPath);
                }
                observableBatcherNotify(listener.callback, value, getPrev, path, valueAtPath, prevAtPath);
            }
        }
    }
}

function createPreviousHandler(value: any, path: (string | number)[], prevAtPath: any) {
    return function () {
        let clone = value ? JSON.parse(JSON.stringify(value)) : path.length > 0 ? {} : value;
        let o = clone;
        if (path.length > 0) {
            let i: number;
            for (i = 0; i < path.length - 1; i++) {
                o = o[path[i]];
            }
            o[path[i]] = prevAtPath;
        } else {
            clone = prevAtPath;
        }
        return clone;
    };
}

function _notifyParents(
    node: ProxyValue,
    value: any,
    path: (string | number)[],
    valueAtPath: any,
    prevAtPath: any,
    level: number
) {
    // Do the notify
    _notify(node, value, path, valueAtPath, prevAtPath, level);
    // If not root notify up through parents
    if (node.path !== '_') {
        const { parent, key } = getParentNode(node);
        if (parent) {
            const parentValue = getNodeValue(parent);
            _notifyParents(parent, parentValue, [key].concat(path), valueAtPath, prevAtPath, level + 1);
        }
    }
}
function notify(node: ProxyValue, value: any, prev: any, level: number) {
    // Start notifying up through parents with the listenerInfo
    _notifyParents(node, value, [], value, prev, level);
}

function prop(node: ProxyValue, key: string | number) {
    const child = getChildNode(node, key);
    return createProxy(child);
}

function assign(node: ProxyValue, value: any) {
    observableBatcher.begin();

    // Assign calls set with all assigned properties
    const keys = Object.keys(value);
    const length = keys.length;
    for (let i = 0; i < length; i++) {
        setProp(node, keys[i], value[keys[i]]);
    }

    const ret = getNodeValue(node);
    observableBatcher.end();

    return ret;
}

function deleteFnProxy(node: ProxyValue, key: string | number) {
    if (key !== undefined) {
        return deleteFn(node, key);
    } else {
        const { parent, key } = getParentNode(node);
        return deleteFn(parent, key);
    }
}
function deleteFn(node: ProxyValue, key?: string | number) {
    if (!node.root.isPrimitive) {
        // delete sets to undefined first to cleanup children
        setProp(node, key, undefined);
    }

    inSetFn = true;
    // Then delete the key from the object
    let child = getNodeValue(node);
    delete child[key];

    inSetFn = false;
}

export function observable<T extends object | Array<any>>(obj: T): Observable<T>;
export function observable<T extends boolean>(prim: T): ObservablePrimitive<boolean>;
export function observable<T extends string>(prim: T): ObservablePrimitive<string>;
export function observable<T extends number>(prim: T): ObservablePrimitive<number>;
export function observable<T extends boolean | string | number>(prim: T): ObservablePrimitive<T>;
export function observable<T>(obj: any): ObservableOrPrimitive<T> {
    const isPrim = isPrimitive(obj);
    // Primitives wrap in current
    if (isPrim) {
        obj = { current: obj };
    }

    const obs = {
        _: obj as Observable,
        isPrimitive: isPrim,
        listenerMap: new Map(),
        proxies: new Map(),
        proxyValues: new Map(),
    } as ObservableWrapper;

    const node: ProxyValue = {
        root: obs,
        path: '_',
        pathParent: '',
        key: '_',
    };

    obs.proxyValues.set(node.path, node);

    updateNodes(node, obs._);

    const proxy = createProxy(node);

    // @ts-ignore
    return proxy;
}
