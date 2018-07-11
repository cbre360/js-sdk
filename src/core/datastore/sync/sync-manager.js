import { Promise } from 'es6-promise';
import clone from 'lodash/clone';

import { Log } from '../../log';
import { KinveyError, NotFoundError, SyncError, InvalidCachedQuery } from '../../errors';
import { getPlatformConfig } from '../../platform-configs';
import { SyncOperation } from './sync-operation';
import { maxEntityLimit, defaultPullSortField } from './utils';
import { isEmpty } from '../utils';
import { repositoryProvider } from '../repositories';
import { Query } from '../../query';
import { ensureArray, isNonemptyString, forEachAsync, splitQueryIntoPages } from '../../utils';
import { deltaSet } from '../deltaset';
import { getCachedQuery, updateCachedQuery, deleteCachedQuery } from '../querycache';

const {
  maxConcurrentPullRequests: maxConcurrentPulls,
  maxConcurrentPushRequests: maxConcurrentPushes,
} = getPlatformConfig();
const pushTrackingByCollection = {};

/**
 * @private
 */
export class SyncManager {
  _offlineRepoPromise;
  _networkRepo;
  /** @type {SyncStateManager} */
  _syncStateManager;

  constructor(networkRepo, syncStateManager) {
    this._networkRepo = networkRepo;
    this._syncStateManager = syncStateManager;
  }

  push(collection, query) {
    if (isEmpty(collection) || !isNonemptyString(collection)) {
      return Promise.reject(new KinveyError('Invalid or missing collection name'));
    }

    if (this._pushIsInProgress(collection)) {
      return Promise.reject(new SyncError('Data is already being pushed to the backend.'
        + ' Please wait for it to complete before pushing new data to the backend.'));
    }

    this._markPushStart(collection);
    let prm = Promise.resolve();

    if (query) {
      prm = this._getEntityIdsForQuery(collection, query);
    }

    return prm
      .then((entityIds) => this._syncStateManager.getSyncItems(collection, entityIds))
      .then((syncItems = []) => this._processSyncItems(collection, syncItems))
      .then((pushResult) => {
        this._markPushEnd(collection);
        return pushResult;
      })
      .catch((err) => {
        this._markPushEnd();
        return Promise.reject(err);
      });
  }

  pull(collection, query, options = {}) {
    return Promise.resolve()
      .then(() => {
        if (!isNonemptyString(collection)) {
          throw new KinveyError('Invalid or missing collection name');
        }
      })
      .then(() => {
        if (options.useDeltaSet) {
          return deltaSet(collection, query, options)
            .then((response) => {
              return getCachedQuery(collection, query)
                .then((cachedQuery) => {
                  if (cachedQuery) {
                    cachedQuery.lastRequest = response.headers.requestStart;
                    return updateCachedQuery(cachedQuery);
                  }

                  return null;
                })
                .then(() => response.data);
            })
            .then((data) => {
              if (data.deleted.length > 0) {
                const deleteQuery = new Query();
                deleteQuery.contains('_id', data.deleted.map((entity) => entity._id));
                return this._deleteOfflineEntities(collection, deleteQuery)
                  .then(() => data);
              }

              return data;
            })
            .then((data) => {
              if (data.changed.length > 0) {
                return this._getOfflineRepo()
                  .then((offlineRepo) => offlineRepo.update(collection, data.changed))
                  .then(() => data.changed.length);
              }

              return 0;
            });
        } else if (options.autoPagination) {
          return this._paginatedPull(collection, query, options);
        }

        return this._fetchItemsFromServer(collection, query, options)
          .then((response) => {
            return getCachedQuery(collection, query)
              .then((cachedQuery) => {
                if (cachedQuery && response.headers) {
                  cachedQuery.lastRequest = response.headers.requestStart;
                  return updateCachedQuery(cachedQuery);
                }

                return null;
              })
              .then(() => response.data ? response.data : response);
          })
          .then((data) => this._replaceOfflineEntities(collection, query, data).then((data) => data.length));
      })
      .catch((error) => {
        if (error instanceof InvalidCachedQuery) {
          return getCachedQuery(collection, query)
            .then((cachedQuery) => deleteCachedQuery(cachedQuery))
            .catch((error) => {
              if (error instanceof NotFoundError) {
                return null;
              }

              throw error;
            })
            .then(() => this.pull(collection, query, Object.assign(options, { useDeltaSet: false })));
        }

        throw error;
      });
  }

  getSyncItemCount(collection) {
    if (!isNonemptyString(collection)) {
      return Promise.reject(new KinveyError('Invalid or missing collection name'));
    }

    return this._syncStateManager.getSyncItemCount(collection);
  }

  // TODO: this method is temporray, pending fix for MLIBZ-2177
  getSyncItemCountByEntityQuery(collection, query) {
    if (!query) {
      return this._syncStateManager.getSyncItemCount(collection);
    }

    return this._getOfflineRepo()
      .then(repo => repo.read(collection, query))
      .then((entities) => {
        const entityIds = entities.map(e => e._id);
        return this._syncStateManager.getSyncItemCount(collection, entityIds);
      });
  }

  // TODO: this only returns nondeleted entities - pending fix for MLIBZ-2177
  getSyncEntities(collection, query) {
    return this._getOfflineRepo()
      .then(repo => repo.read(collection, query))
      .then((entities = []) => {
        return this._syncStateManager.getSyncItems(collection, entities.map(e => e._id));
      });
  }

  // TODO: pending fix for MLIBZ-2177
  clearSync(collection, query) {
    if (query) {
      return this._getEntityIdsForQuery(collection, query)
        .then(entityIds => this._syncStateManager.removeSyncItemsForIds(collection, entityIds));
    }
    return this._syncStateManager.removeAllSyncItems(collection);
  }

  // for SyncStateManager
  addCreateEvent(collection, createdItems) {
    return this._addEvent(collection, createdItems, SyncOperation.Create);
  }

  addDeleteEvent(collection, deletedEntities) {
    return this._addEvent(collection, deletedEntities, SyncOperation.Delete);
  }

  addUpdateEvent(collection, updatedEntities) {
    return this._addEvent(collection, updatedEntities, SyncOperation.Update);
  }

  removeSyncItemForEntityId(collection, entityId) {
    return this._syncStateManager.removeSyncItemForEntityId(collection, entityId);
  }

  removeSyncItemsForIds(collection, entityIds) {
    return this._syncStateManager.removeSyncItemsForIds(collection, entityIds);
  }

  _deleteOfflineEntities(collection, query) {
    return this._getOfflineRepo()
      .then(repo => repo.delete(collection, query));
  }

  _replaceOfflineEntities(collection, deleteOfflineQuery, networkEntities = []) {
    // TODO: this can potentially be deleteOfflineQuery.and().notIn(networkEntitiesIds)
    // but inmemory filtering with this filter seems to take too long
    if (deleteOfflineQuery && (deleteOfflineQuery.hasSkip() || deleteOfflineQuery.hasLimit())) {
      return this._getOfflineRepo()
        .then((repo) => repo.update(collection, networkEntities));
    }

    return this._deleteOfflineEntities(collection, deleteOfflineQuery)
      .then(() => this._getOfflineRepo())
      .then(repo => repo.update(collection, networkEntities));
  }

  _getPushOpResult(entityId, operation) {
    const result = {
      _id: entityId,
      operation: operation
    };

    if (operation !== SyncOperation.Delete) {
      result.entity = null;
    }

    return result;
  }

  _sanitizeOfflineEntity(offlineEntity) {
    const copy = clone(offlineEntity);
    delete copy._id;
    if (copy._kmd) {
      delete copy._kmd.local;
    }
    return copy;
  }

  _replaceOfflineEntityWithNetwork(collection, offlineEntityId, networkEntity) {
    let offlineRepo;
    return this._getOfflineRepo()
      .then((repo) => {
        offlineRepo = repo;
        return offlineRepo.deleteById(collection, offlineEntityId);
      })
      .then(() => offlineRepo.create(collection, networkEntity));
  }

  _pushCreate(collection, entity) {
    let entityToCreate = entity;
    if (entity._kmd && entity._kmd.local) {
      entityToCreate = this._sanitizeOfflineEntity(entity);
    }
    const result = this._getPushOpResult(entity._id, SyncOperation.Create);
    return this._networkRepo.create(collection, entityToCreate)
      .then((createdItem) => {
        result.entity = createdItem;
        return this._replaceOfflineEntityWithNetwork(collection, entity._id, createdItem);
      })
      .then(() => result)
      .catch((err) => {
        result.error = err;
        return result;
      });
  }

  _pushDelete(collection, entityId) {
    const result = this._getPushOpResult(entityId, SyncOperation.Delete);
    return this._networkRepo.deleteById(collection, entityId)
      .then(() => result)
      .catch((err) => {
        result.error = err;
        return result;
      });
  }

  _pushUpdate(collection, entity) {
    const result = this._getPushOpResult(entity._id, SyncOperation.Update);
    return this._networkRepo.update(collection, entity)
      .then((updateResult) => {
        result.entity = updateResult;
        return this._getOfflineRepo();
      })
      .then(repo => repo.update(collection, result.entity))
      .then(() => result)
      .catch((err) => {
        result.entity = entity;
        result.error = err;
        return result;
      });
  }

  _handlePushOp(collection, syncItem, offlineEntity) {
    const { state, entityId } = syncItem;
    const syncOp = state.operation;

    switch (syncOp) {
      case SyncOperation.Create:
        return this._pushCreate(collection, offlineEntity);
      case SyncOperation.Delete:
        return this._pushDelete(collection, entityId);
      case SyncOperation.Update:
        return this._pushUpdate(collection, offlineEntity);
      default: {
        const res = this._getPushOpResult(entityId, syncOp);
        res.error = new SyncError(`Unexpected sync operation: ${syncOp}`);
        return res;
      }
    }
  }

  _pushItem(collection, syncItem) {
    const { entityId, state } = syncItem;
    return this._getOfflineRepo()
      .then(repo => repo.readById(collection, entityId)) // TODO: we've already read the entities once, if a query was provided
      .catch((err) => {
        if (!(err instanceof NotFoundError)) {
          return Promise.reject(err);
        }
        if (state.operation !== SyncOperation.Delete) {
          return this._syncStateManager.removeSyncItemForEntityId(collection, entityId)
            .then(() => Promise.reject(err));
        }
        return null; // we have to make a delete request to the backend
      })
      .then(offlineEntity => this._handlePushOp(collection, syncItem, offlineEntity));
  }

  _processSyncItem(collection, syncItem) {
    return this._pushItem(collection, syncItem)
      .then((result) => {
        if (result.error) {
          return result;
        }
        return this._syncStateManager.removeSyncItemForEntityId(syncItem.collection, syncItem.entityId)
          .then(() => result);
      })
      .catch((err) => {
        const pushResult = this._getPushOpResult(syncItem.entityId, syncItem.state.operation);
        pushResult.error = err;
        return pushResult;
      });
  }

  _processSyncItems(collection, syncItems) {
    const pushResults = [];
    return forEachAsync(syncItems, (syncItem) => {
      return this._processSyncItem(collection, syncItem) // never rejects
        .then(pushResult => pushResults.push(pushResult));
    }, maxConcurrentPushes)
      .then(() => pushResults);
  }

  _fetchItemsFromServer(collection, query, options) {
    return this._networkRepo.read(collection, query, Object.assign(options, { dataOnly: false }));
  }

  _getOfflineRepo() {
    if (!this._offlineRepoPromise) {
      this._offlineRepoPromise = repositoryProvider.getOfflineRepository();
    }
    return this._offlineRepoPromise;
  }

  _pushIsInProgress(collection) {
    return !!pushTrackingByCollection[collection];
  }

  _markPushStart(collection) {
    if (!this._pushIsInProgress(collection)) {
      pushTrackingByCollection[collection] = true;
    } else {
      Log.debug('Marking push start, when push already started');
    }
  }

  _markPushEnd(collection) {
    if (this._pushIsInProgress(collection)) {
      delete pushTrackingByCollection[collection];
    } else {
      Log.debug('Marking push end, when push is NOT started');
    }
  }

  _getEntityIdsForQuery(collection, query) {
    return this._getOfflineRepo()
      .then(repo => repo.read(collection, query))
      .then(entities => entities.map(e => e._id));
  }

  _addEvent(collection, entities, syncOp) {
    const validationError = this._validateCrudEventEntities(entities);

    if (validationError) {
      return validationError;
    }

    return this._setState(collection, entities, syncOp)
      .then(() => entities);
  }

  _validateCrudEventEntities(entities) {
    if (!entities || isEmpty(entities)) {
      return Promise.reject(new SyncError('Invalid or missing entity/entities array.'));
    }

    const entityWithNoId = ensureArray(entities).find(e => !e._id);
    if (entityWithNoId) {
      const errMsg = 'An entity is missing an _id. All entities must have an _id in order to be added to the sync table.';
      return Promise.reject(new SyncError(errMsg, entityWithNoId));
    }
    return null;
  }

  _setState(collection, entities, syncOp) {
    switch (syncOp) {
      case SyncOperation.Create:
        return this._syncStateManager.addCreateEvent(collection, entities);
      case SyncOperation.Update:
        return this._syncStateManager.addUpdateEvent(collection, entities);
      case SyncOperation.Delete:
        return this._syncStateManager.addDeleteEvent(collection, entities);
      default:
        return Promise.reject(new SyncError('Invalid sync event name'));
    }
  }

  _getInternalPullQuery(userQuery, totalCount) {
    userQuery = userQuery || {};
    const { filter, sort, fields } = userQuery;
    const query = new Query({ filter, sort, fields });
    query.limit = totalCount;

    if (!sort || isEmpty(sort)) {
      query.sort = { [defaultPullSortField]: 1 };
    }
    return query;
  }

  _fetchAndUpdateEntities(collection, query, options) {
    return this._networkRepo.read(collection, query, options)
      .then((entities) => {
        return this._getOfflineRepo()
          .then(repo => repo.update(collection, entities));
      });
  }

  _executePaginationQueries(collection, queries, options) {
    let pulledEntityCount = 0;
    return forEachAsync(queries, (query) => {
      return this._fetchAndUpdateEntities(collection, query, options)
        .then((updatedEntities) => {
          pulledEntityCount += updatedEntities.length;
        });
    }, maxConcurrentPulls)
      .then(() => pulledEntityCount);
  }

  _getExpectedEntityCount(collection, userQuery) {
    const countQuery = new Query({ filter: userQuery.filter });
    return this._networkRepo.count(collection, countQuery, { dataOnly: false })
      .then((response) => {
        return {
          lastRequest: response.headers ? response.headers.requestStart : undefined,
          count: response.data ? response.data.count : response
        };
      });
  }

  _paginatedPull(collection, userQuery, options = {}) {
    let pullQuery;
    userQuery = userQuery || new Query();
    return this._getExpectedEntityCount(collection, userQuery)
      .then(({ lastRequest, count }) => {
        pullQuery = this._getInternalPullQuery(userQuery, count);
        return this._deleteOfflineEntities(collection)
          .then(() => {
            const pageSizeSetting = options.autoPagination && options.autoPagination.pageSize;
            const pageSize = pageSizeSetting || maxEntityLimit;
            const paginatedQueries = splitQueryIntoPages(pullQuery, pageSize, count);
            return this._executePaginationQueries(collection, paginatedQueries, options);
          })
          .then((result) => {
            return getCachedQuery(collection, userQuery)
              .then((cachedQuery) => {
                if (cachedQuery) {
                  cachedQuery.lastRequest = lastRequest;
                  return updateCachedQuery(cachedQuery);
                }

                return null;
              })
              .then(() => result);
          });
      });
  }
}
