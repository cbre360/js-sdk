import isString from 'lodash/isString';
import url from 'url';

import { CacheRequest, RequestMethod } from 'src/request';
import { KinveyError } from 'src/errors';
import { isDefined } from 'src/utils';
import Client from 'src/client';
import NetworkStore from './networkstore';
import CacheStore from './cachestore';
import SyncStore from './syncstore';
import { PersistanceType } from './persistance-type';

/**
 * @typedef   {Object}    DataStoreType
 * @property  {string}    Cache           Cache datastore type
 * @property  {string}    Network         Network datastore type
 * @property  {string}    Sync            Sync datastore type
 */
const DataStoreType = {
  Cache: 'Cache',
  Network: 'Network',
  Sync: 'Sync'
};
Object.freeze(DataStoreType);
export { DataStoreType };

/**
 * The DataStore class is used to find, create, update, remove, count and group entities.
 */
export default class DataStore {
  constructor() {
    throw new KinveyError('Not allowed to construct a DataStore instance.'
      + ' Please use the collection() function to get an instance of a DataStore instance.');
  }

  /**
   * Returns an instance of the Store class based on the type provided.
   *
   * @param  {string}       [collection]                  Name of the collection.
   * @param  {StoreType}    [type=DataStoreType.Network]  Type of store to return.
   * @return {DataStore}                                  DataStore instance.
   */
  static collection(collection, type = DataStoreType.Cache, options) {
    let store;

    if (isDefined(collection) === false || isString(collection) === false) {
      throw new KinveyError('A collection is required and must be a string.');
    }

    switch (type) {
      case DataStoreType.Network:
        store = new NetworkStore(collection, options);
        break;
      case DataStoreType.Sync:
        store = new SyncStore(collection, options);
        break;
      case DataStoreType.Cache:
      default:
        store = new CacheStore(collection, options);

    }

    return store;
  }

  /**
   * @private
   */
  static getInstance(collection, type, options) {
    return this.collection(collection, type, options);
  }

  /**
   * Clear the cache. This will delete all data in the cache.
   *
   * @param  {Object} [options={}] Options
   * @return {Promise<Object>} The result of clearing the cache.
   */
  static clearCache(options = {}) {
    const client = options.client || Client.sharedInstance();
    const pathname = `/appdata/${client.appKey}`;
    const request = new CacheRequest({
      method: RequestMethod.DELETE,
      url: url.format({
        protocol: client.apiProtocol,
        host: client.apiHost,
        pathname: pathname
      }),
      properties: options.properties,
      timeout: options.timeout
    });
    return request.execute()
      .then(response => response.data);
  }

  static Persistance = PersistanceType;
}
