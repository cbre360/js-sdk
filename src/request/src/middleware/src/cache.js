import isEmpty from 'lodash/isEmpty';

import { isDefined } from 'src/utils';
import Middleware from './middleware';
import { Storage } from './storage';

export default class CacheMiddleware extends Middleware {
  constructor(name = 'Cache Middleware') {
    super(name);
  }

  loadStorage(name) {
    return new Storage(name);
  }

  handle(request) {
    const { method, body, appKey, collection, entityId, query } = request;
    const storage = this.loadStorage(appKey);
    let promise;

    if (method === 'GET') {
      if (isDefined(entityId)) {
        promise = storage.findById(collection, entityId);
      } else {
        promise = storage.find(collection);
      }
    } else if (method === 'POST' || method === 'PUT') {
      if (entityId === '_group') {
        promise = storage.find(collection);
      } else {
        promise = storage.save(collection, body);
      }
    } else if (method === 'DELETE') {
      if (isDefined(collection) === false) {
        promise = storage.clear();
      } else if (query) {
        const idsToRemove = query.filter && query.filter._id && query.filter._id.$in;
        promise = storage.remove(collection, idsToRemove);
      } else if (entityId) {
        promise = storage.removeById(collection, entityId);
      } else {
        return Promise.reject(new Error('Should not happen')); // TODO: remove
      }
    }

    return promise.then((data) => {
      const response = {
        statusCode: method === 'POST' ? 201 : 200,
        data: data
      };


      if (method === 'POST' && entityId === '_group') {
        response.statusCode = 200;
      }

      if (isDefined(data) === false || isEmpty(data)) {
        response.statusCode = 204;
      }

      return response;
    })
      .catch(error => ({ statusCode: error.code }))
      .then(response => ({ response: response }));
  }
}
