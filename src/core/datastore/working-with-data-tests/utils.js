import expect from 'expect';
import times from 'lodash/times';
import { Promise } from 'es6-promise';

import { Operation } from '../operations';
import { DataStoreType } from '../datastore';
import { NetworkStore } from '../networkstore';
import { CacheStore } from '../cachestore';
import { SyncStore } from '../syncstore';

import { mockRequiresIn } from '../require-helper';

const typeToFilePathMap = {
  [DataStoreType.Sync]: '../syncstore',
  [DataStoreType.Cache]: '../cachestore',
  [DataStoreType.Network]: '../networkstore'
};

const buildDataStoreInstance = (storeType, collection, dataProcessor, options) => {
  switch (storeType) {
    case DataStoreType.Sync:
      return new SyncStore(collection, dataProcessor, options);
    case DataStoreType.Cache:
      return new CacheStore(collection, dataProcessor, options);
    case DataStoreType.Network:
      return new NetworkStore(collection, dataProcessor, options);
    default:
      throw new Error('Unexpected store type');
  }
};

const storeBuilder = (storeType, collection, dataProcessor, requireMocks, options) => {
  if (!requireMocks) {
    return buildDataStoreInstance(storeType, collection, dataProcessor, options);
  }

  const DataStoreClass = mockRequiresIn(__dirname, typeToFilePathMap[storeType], requireMocks, `${storeType}Store`);
  return new DataStoreClass(collection, dataProcessor, options);
};

/**
 * @private
 */
export const datastoreFactory = {
  [DataStoreType.Sync]: storeBuilder.bind(this, DataStoreType.Sync),
  [DataStoreType.Cache]: storeBuilder.bind(this, DataStoreType.Cache),
  [DataStoreType.Network]: storeBuilder.bind(this, DataStoreType.Network)
};

/**
 * @private
 * @param {Operation} op
 */
export function validateOperationObj(op, type, collection, query, data, entityId) {
  expect(op).toBeA(Operation);
  expect(op.type).toEqual(type);
  expect(op.collection).toEqual(collection);
  expect(op.query).toBe(query);
  expect(op.data).toBe(data);
  expect(op.entityId).toBe(entityId);
}

/**
 * @private
 */
export function createPromiseSpy(value, reject = false) {
  const promise = reject === true ? Promise.reject(value) : Promise.resolve(value);
  return expect.createSpy().andReturn(promise);
}

/**
 * @private
 * @returns {RepoMock}
 */
export function getRepoMock(results = {}) {
  return {
    read: createPromiseSpy(results.read || []),
    readById: createPromiseSpy(results.readById || {}),
    create: createPromiseSpy(results.create || {}),
    deleteById: createPromiseSpy(results.deleteById || 1),
    update: createPromiseSpy(results.update || {}),
    delete: createPromiseSpy(results.delete || 1e6),
    group: createPromiseSpy(results.group || null),
    clear: createPromiseSpy(results.clear || null),
    count: createPromiseSpy(results.count || 1e6),
  };
}

/**
 * @private
 */
export function getSyncManagerMock() {
  return {
    getSyncItemCountByEntityQuery: createPromiseSpy(0),
    removeSyncItemForEntityId: createPromiseSpy(),
    removeSyncItemsForIds: createPromiseSpy(),
    addCreateEvent: createPromiseSpy(),
    addUpdateEvent: createPromiseSpy(),
    addDeleteEvent: createPromiseSpy(),
    clearSync: createPromiseSpy(),
    push: createPromiseSpy()
  };
}

/**
 * @private
 */
export function validateError(err, expectedType, expectedMessage) {
  expect(err).toExist();
  expect(err).toBeA(expectedType);
  expect(err.message).toInclude(expectedMessage);
}

/**
 * @private
 */
export function validateSpyCalls(spy, callCount, ...callArgumentSets) {
  expect(spy.calls.length).toBe(callCount);
  times(callCount, (index) => {
    const expectedArguments = callArgumentSets[index];
    expect(spy.calls[index].arguments.length).toBe(expectedArguments.length);
    expectedArguments.forEach((arg, ind) => {
      expect(spy.calls[index].arguments[ind]).toEqual(arg);
    });
  });
}

/**
 * @private
 */
export function addExpectedCreateEntityMeta(entity) {
  return Object.assign({}, entity, { _kmd: { local: true } });
}
