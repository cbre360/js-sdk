import { Promise } from 'es6-promise';
import assign from 'lodash/assign';

import { isDefined } from '../utils';
import { NetworkStore } from './networkstore';

import { OperationType } from './operations';
import { processorFactory } from './processors';
import { syncManagerProvider } from './sync';
import { formTaggedCollectionName } from './utils';

/**
 * The CacheStore class is used to find, create, update, remove, count and group entities. Entities are stored
 * in a cache and synced with the backend.
 */
export class CacheStore extends NetworkStore {
  constructor(collection, processor, options = {}) {
    collection = formTaggedCollectionName(collection, options.tag);
    const proc = processor || processorFactory.getCacheOfflineDataProcessor();
    super(collection, proc, options);

    /**
     * @type {number|undefined}
     */
    this.ttl = options.ttl || undefined;
    this.syncManager = syncManagerProvider.getSyncManager();
  }

  /**
   * Remove a single entity in the data store by id.
   *
   * @param   {string}                id                               Entity by id to remove.
   * @param   {Object}                [options]                        Options
   * @param   {Properties}            [options.properties]             Custom properties to send with
   *                                                                   the request.
   * @param   {Number}                [options.timeout]                Timeout for the request.
   * @return  {Promise}                                                Promise.
   */
  removeById(id, options = {}) {
    if (!isDefined(id)) {
      return Promise.resolve({ count: 0 });
    }

    return super.removeById(id, options);
  }

  /**
   * Remove all entities in the data store that are stored locally.
   *
   * @param   {Query}                 [query]                           Query used to filter entities.
   * @param   {Object}                [options]                         Options
   * @param   {Properties}            [options.properties]              Custom properties to send with
   *                                                                    the request.
   * @param   {Number}                [options.timeout]                 Timeout for the request.
   * @return  {Promise}                                                 Promise.
   */
  clear(query, options = {}) {
    const errPromise = this._validateQuery(query);
    if (errPromise) {
      return errPromise;
    }

    const operation = this._buildOperationObject(OperationType.Clear, query);
    return this._executeOperation(operation, options)
      .then(count => ({ count }));
  }

  /**
   * Count the number of entities waiting to be pushed to the network. A promise will be
   * returned with the count of entities or rejected with an error.
   *
   * @param   {Query}                 [query]                                   Query to count a subset of entities.
   * @return  {Promise}                                                         Promise
   */
  pendingSyncCount(query) {
    if (query) {
      return this.syncManager.getSyncItemCountByEntityQuery(this.collection, query);
    }
    return this.syncManager.getSyncItemCount(this.collection);
  }

  pendingSyncEntities(query) {
    return this.syncManager.getSyncEntities(this.collection, query);
  }

  /**
   * Push sync items for the data store to the network. A promise will be returned that will be
   * resolved with the result of the push or rejected with an error.
   *
   * @param   {Query}                 [query]                                   Query to push a subset of items.
   * @param   {Object}                options                                   Options
   * @param   {Properties}            [options.properties]                      Custom properties to send with
   *                                                                            the request.
   * @param   {Number}                [options.timeout]                         Timeout for the request.
   * @return  {Promise}                                                         Promise
   */
  push(query, options) {
    return this.syncManager.push(this.collection, query, options);
  }

  /**
   * Pull items for the data store from the network to your local cache. A promise will be
   * returned that will be resolved with the result of the pull or rejected with an error.
   *
   * @param   {Query}                 [query]                                   Query to pull a subset of items.
   * @param   {Object}                options                                   Options
   * @param   {Properties}            [options.properties]                      Custom properties to send with
   *                                                                            the request.
   * @param   {Number}                [options.timeout]                         Timeout for the request.
   * @return  {Promise}                                                         Promise
   */
  pull(query, options = {}) {
    options = assign({ useDeltaFetch: this.useDeltaFetch }, options);
    // TODO: the query issue must be resolved - entity or sync entity
    return this.syncManager.getSyncItemCountByEntityQuery(this.collection, query)
      .then((count) => {
        if (count > 0) {
          // TODO: I think this should happen, but keeping current behaviour
          // const msg = `There are ${count} entities awaiting push. Please push before you attempt to pull`;
          // return Promise.reject(new KinveyError(msg));
          return this.syncManager.push(this.collection, query);
        }
        return Promise.resolve();
      })
      .then(() => this.syncManager.pull(this.collection, query, options));
  }

  /**
   * Sync items for the data store. This will push pending sync items first and then
   * pull items from the network into your local cache. A promise will be
   * returned that will be resolved with the result of the pull or rejected with an error.
   *
   * @param   {Query}                 [query]                                   Query to pull a subset of items.
   * @param   {Object}                options                                   Options
   * @param   {Properties}            [options.properties]                      Custom properties to send with
   *                                                                            the request.
   * @param   {Number}                [options.timeout]                         Timeout for the request.
   * @return  {Promise}                                                         Promise
   */
  sync(query, options) {
    options = assign({ useDeltaFetch: this.useDeltaFetch }, options);
    return this.push(query, options)
      .then((push) => {
        const promise = this.pull(query, options)
          .then((pull) => {
            const result = {
              push: push,
              pull: pull
            };
            return result;
          });
        return promise;
      });
  }

  clearSync(query) {
    return this.syncManager.clearSync(this.collection, query);
  }
}
