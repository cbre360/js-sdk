import Promise from 'es6-promise';
import { KinveyError } from '../../errors';
import { Middleware } from './middleware';

/**
 * @private
 */
export class HttpMiddleware extends Middleware {
  constructor(name = 'Http Middleware') {
    super(name);
  }

  handle() {
    return Promise.reject(new KinveyError('Unable to send network request.',
      'Please override the core HttpMiddleware.'));
  }

  cancel() {
    return Promise.resolve();
  }
}
