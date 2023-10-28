import type { CacheOptions, ObservablePersistStateBase, RetryOptions } from '@legendapp/state';
export { configureObservablePersistence } from './src/persist/configureObservablePersistence';
export { invertFieldMap, transformObject, transformPath } from './src/persist/fieldTransformer';
export { mapPersistences, persistObservable } from './src/persist/persistObservable';
import { internal as internalState } from '@legendapp/state';

export function isInRemoteChange() {
    return internalState.globalState.isLoadingRemote$.get();
}

import type { ObservablePersistenceConfig } from './src/observableInterfaces';
import { observablePersistConfiguration } from './src/persist/configureObservablePersistence';
export const internal: {
    observablePersistConfiguration: ObservablePersistenceConfig;
} = {
    observablePersistConfiguration,
};

import { persistActivateNode } from './src/persist/persistActivateNode';
persistActivateNode();

declare module '@legendapp/state' {
    interface ActivateParams<T> {
        cache: (cacheOptions: CacheOptions<T>) => Promise<{ dateModified: number }>;
        updateLastSync: (lastSync: number) => void;
        retry: (options?: RetryOptions) => void;
    }
    // interface OnSetExtra {}
    // interface SubscribeOptions {}
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface ObservableState extends ObservablePersistStateBase {}
}
