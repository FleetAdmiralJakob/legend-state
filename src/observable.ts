import { extractPromise, getProxy } from './ObservableObject';
import { ObservablePrimitiveClass } from './ObservablePrimitive';
import { createObservable } from './createObservable';
import { globalState } from './globals';
import type {
    ActivateParams,
    ActivateProxyParams,
    ActivatorFunction,
    Observable,
    ObservableComputed,
    ObservablePrimitive,
    RecordValue,
    WithState,
} from './observableInterfaces';
import type { Observable as ObservableNew } from './observableTypes';

type TWithFunctions<T> =
    | T
    | {
          [K in keyof T]:
              | ((
                    params: ActivateProxyParams<T[K] | RecordValue<T[K]>>,
                ) => TWithFunctions<T[K]> | Promise<TWithFunctions<T[K]>> | void)
              | TWithFunctions<T[K]>;
      };

type AllowFns<T> = (T extends () => infer t ? T | t : T | (() => T)) & {
    [K in keyof T]: AllowFns<T[K]>;
};

type RecursiveStringOrFunction = {
    [key: string]: string | (() => string) | RecursiveStringOrFunction;
};

type ValueOrFunction<T> = T extends Function ? T : T | (() => T | Promise<T>);
type ValueOrFunctionKeys<T> = {
    [K in keyof T]: RecursiveValueOrFunction<T[K]>;
};
type RecursiveValueOrFunction<T> = T extends Function
    ? T
    : T extends object
    ? (() => T | Promise<T>) | ValueOrFunctionKeys<T> | (() => ValueOrFunctionKeys<T>)
    : ValueOrFunction<T>;

export function observable<T>(): ObservableNew<T | undefined>;
export function observable<T>(value: RecursiveValueOrFunction<T>): ObservableNew<T>;
// export function observable<T>(value: Promise<T>): Observable<T & WithState>;
// export function observable<T>(value: Promise<T>): Observable<T & WithState>;
// export function observable<T>(value: () => Observable<T>): Observable<T>;
// export function observable<T>(value: () => Promise<T>): Observable<T & WithState>;
// export function observable<T>(value: ActivatorFunction<T>): Observable<T>;
// export function observable<T>(value: () => T): ObservableComputed<T>;
// export function observable<T>(value: (params: ActivateParams) => Observable<T>): Observable<T & WithState>;
// export function observable<T>(value: (params: ActivateParams) => Promise<T>): Observable<T & WithState>;
// export function observable<T>(value: (params: ActivateParams) => T): Observable<T>;
// export function observable<T>(
//     value: (params: ActivateProxyParams<T>) => void,
// ): Observable<Record<string, T> & WithState>;
// export function observable<T>(value?: TWithFunctions<T>): Observable<T>;
export function observable<T>(value?: T): any {
    return createObservable(value, false, extractPromise, getProxy, ObservablePrimitiveClass) as Observable<any>;
}

export function observablePrimitive<T>(value: Promise<T>): ObservablePrimitive<T & WithState>;
export function observablePrimitive<T>(value?: T): ObservablePrimitive<T>;
export function observablePrimitive<T>(value?: T | Promise<T>): ObservablePrimitive<T & WithState> {
    return createObservable(value, true, extractPromise, getProxy, ObservablePrimitiveClass) as ObservablePrimitive<
        T & WithState
    >;
}

// globalState.isLoadingRemote$ = observable(false);
