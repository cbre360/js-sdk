import { Promise } from 'es6-promise';
import keyBy from 'lodash/keyBy';

import { NotFoundError } from '../../../errors';

import { OfflineRepository } from '../offline-repository';
import { applyQueryToDataset, applyAggregationToDataset } from '../utils';
import { ensureArray, activeUserKey } from '../../../utils';

// Imported for typings
// import { KeyValuePersister } from '../../persisters';
/**
 * @private
 */
export class InmemoryOfflineRepository extends OfflineRepository {
  /** @type {KeyValuePersister} */
  _persister;
  /** @type {PromiseQueue} */
  _queue;

  constructor(persister, promiseQueue) {
    super();
    this._persister = persister;
    this._queue = promiseQueue;
  }

  // ----- public methods

  create(collection, entitiesToSave) {
    return this._enqueueCrudOperation(collection, () => {
      return this._create(collection, entitiesToSave)
        .then(() => entitiesToSave);
    });
  }

  read(collection, query) {
    return this._readAll(collection)
      .then((allEntities) => {
        if (query) {
          return applyQueryToDataset(allEntities, query);
        }
        return allEntities;
      });
  }

  readById(collection, id) {
    return this._readAll(collection)
      .then((allEntities) => {
        const entity = allEntities.find(e => e._id === id);
        if (!entity) {
          const errMsg = `An entity with id ${id} was not found in the collection "${collection}"`;
          return Promise.reject(new NotFoundError(errMsg));
        }
        return entity;
      });
  }

  count(collection, query) {
    return this._readAll(collection)
      .then(allEntities => applyQueryToDataset(allEntities, query).length);
  }

  update(collection, entities) {
    return this._enqueueCrudOperation(collection, () => {
      return this._update(collection, entities)
        .then(() => entities);
    });
  }

  delete(collection, query) {
    return this._enqueueCrudOperation(collection, () => {
      return this._delete(collection, query);
    });
  }

  deleteById(collection, id) {
    return this._enqueueCrudOperation(collection, () => {
      return this._deleteById(collection, id);
    });
  }

  clear(collection) {
    let collectionsPromise = Promise.resolve(collection);
    if (!collection) {
      collectionsPromise = this._getAllCollections();
    }

    return collectionsPromise
      .then(collections => this._clearCollections(collections));
  }

  group(collection, aggregationQuery) {
    return this._readAll(collection)
      .then(allEntities => applyAggregationToDataset(allEntities, aggregationQuery));
  }

  // protected methods

  _formCollectionKey(collection) {
    const appKey = this._getAppKey();
    return `${appKey}.${collection}`;
  }

  _deleteMatchingEntitiesFromPersistance(collection, allEntities, entitiesMatchedByQuery) {
    const shouldDeleteById = keyBy(entitiesMatchedByQuery, '_id');
    const remainingEntities = allEntities.filter(e => !shouldDeleteById[e._id]);
    const deletedCount = allEntities.length - remainingEntities.length;
    if (deletedCount > 0) {
      return this._saveAll(collection, remainingEntities);
    }
    return Promise.resolve();
  }

  _delete(collection, query) {
    return this._readAll(collection)
      .then((allEntities) => {
        const matchingEntities = applyQueryToDataset(allEntities, query);
        return this._deleteMatchingEntitiesFromPersistance(collection, allEntities, matchingEntities)
          .then(() => matchingEntities.length);
      });
  }

  _deleteById(collection, id) {
    return this._readAll(collection)
      .then((allEntities) => {
        const index = allEntities.findIndex(e => e._id === id);
        if (index > -1) {
          allEntities.splice(index, 1);
          return this._saveAll(collection, allEntities)
            .then(() => 1);
        }
        return Promise.resolve(0);
      });
  }

  _getAllCollections() {
    return this._persister.getKeys()
      .then((keys) => {
        const collections = [];
        keys = keys || [];
        keys.forEach((key) => {
          if (this._keyBelongsToApp(key)) {
            collections.push(this._getCollectionFromKey(key));
          }
        });
        return collections;
      });
  }

  // this is now used in the ReactNative shim as a protected method
  _update(collection, entities) {
    const entitiesArray = ensureArray(entities);
    const updateEntitiesById = keyBy(entitiesArray, '_id');
    let unprocessedEntitiesCount = entitiesArray.length;
    return this._readAll(collection)
      .then((allEntities) => {
        allEntities.forEach((entity, index) => {
          if (unprocessedEntitiesCount > 0 && updateEntitiesById[entity._id]) {
            allEntities[index] = updateEntitiesById[entity._id];
            delete updateEntitiesById[entity._id];
            unprocessedEntitiesCount -= 1;
          }
        });

        // the upsert part
        if (unprocessedEntitiesCount > 0) {
          Object.keys(updateEntitiesById).forEach((entityId) => {
            allEntities.push(updateEntitiesById[entityId]);
          });
        }

        return this._saveAll(collection, allEntities);
      });
  }

  // ----- private methods

  _readAll(collection) {
    const key = this._formCollectionKey(collection);
    return this._persister.read(key)
      .then(entities => entities || []);
  }

  // TODO: Keep them by id - maybe after the redesign
  _saveAll(collection, entities) {
    const key = this._formCollectionKey(collection);
    return this._persister.write(key, entities);
  }

  _deleteAll(collection) {
    const appKey = this._getAppKey();
    const key = this._formCollectionKey(collection);

    if (key !== `${appKey}.${activeUserKey}`) {
      return this._persister.delete(key);
    }

    return Promise.resolve();
  }

  _enqueueCrudOperation(collection, operation) {
    const key = this._formCollectionKey(collection);
    return this._queue.enqueue(key, operation);
  }

  _keyBelongsToApp(key) {
    const appKey = this._getAppKey();
    return key.indexOf(appKey) === 0;
  }

  _getCollectionFromKey(key) {
    const appKey = this._getAppKey();
    return key.substring(`${appKey}.`.length);
  }

  _clearCollections(collections) {
    const promises = ensureArray(collections)
      .map(c => this._enqueueCrudOperation(c, () => this._deleteAll(c)));
    return Promise.all(promises)
      .then(() => true);
  }

  _create(collection, entitiesToSave) {
    return this._readAll(collection)
      .then((existingEntities) => {
        existingEntities = existingEntities.concat(entitiesToSave);
        return this._saveAll(collection, existingEntities);
      });
  }
}
