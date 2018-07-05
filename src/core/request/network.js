import Promise from 'es6-promise';
import { Buffer } from 'buffer';
import qs from 'qs';
import assign from 'lodash/assign';
import defaults from 'lodash/defaults';
import isEmpty from 'lodash/isEmpty';
import isPlainObject from 'lodash/isObject';
import url from 'url';
import isString from 'lodash/isString';
import { Subject } from 'rxjs/Subject';
import PQueue from 'p-queue';
import { Client } from '../client';
import { Query } from '../query';
import { Aggregation } from '../aggregation';
import { isDefined, appendQuery } from '../utils';
import { InvalidCredentialsError, NoActiveUserError, KinveyError, InvalidGrantError } from '../errors';
import { Request, RequestMethod } from './request';
import { Headers } from './headers';
import { NetworkRack } from './rack';
import { KinveyResponse } from './response';
import { Log } from '../log';

const requestQueue = new PQueue({ concurrency: Infinity });

/**
 * @private
 */
export class NetworkRequest extends Request {
  constructor(options = {}) {
    super(options);
    this.rack = NetworkRack;
  }
}

/**
 * @private
 */
export const AuthType = {
  All: 'All',
  App: 'App',
  Basic: 'Basic',
  Default: 'Default',
  Master: 'Master',
  None: 'None',
  Session: 'Session',
  Client: 'Client'
};
Object.freeze(AuthType);

const Auth = {
  /**
   * Authenticate through (1) user credentials, (2) Master Secret, or (3) App
   * Secret.
   *
   * @returns {Object}
   */
  all(client) {
    return Auth.session(client)
      .catch(() => Auth.basic(client));
  },

  /**
   * Authenticate through App Secret.
   *
   * @returns {Object}
   */
  app(client) {
    if (!client.appKey || !client.appSecret) {
      return Promise.reject(
        new Error('Missing client appKey and/or appSecret.'
          + ' Use Kinvey.initialize() to set the appKey and appSecret for the client.')
      );
    }

    return Promise.resolve({
      scheme: 'Basic',
      username: client.appKey,
      password: client.appSecret
    });
  },

  /**
   * Authenticate through (1) Master Secret, or (2) App Secret.
   *
   * @returns {Object}
   */
  basic(client) {
    return Auth.master(client)
      .catch(() => Auth.app(client));
  },

  client(client, clientId) {
    if (!client.appKey || !client.appSecret) {
      return Promise.reject(
        new Error('Missing client appKey and/or appSecret'
          + ' Use Kinvey.initialize() to set the appKey and appSecret for the client.')
      );
    }
    if (!clientId){
      clientId = client.appKey;
    }
    return Promise.resolve({
      scheme: 'Basic',
      username: clientId,
      password: client.appSecret
    });
  },

  /**
   * Authenticate through Master Secret.
   *
   * @returns {Object}
   */
  master(client) {
    if (!client.appKey || !client.masterSecret) {
      return Promise.reject(
        new Error('Missing client appKey and/or masterSecret.'
          + ' Use Kinvey.initialize() to set the appKey and masterSecret for the client.')
      );
    }

    return Promise.resolve({
      scheme: 'Basic',
      username: client.appKey,
      password: client.masterSecret
    });
  },

  /**
   * Do not authenticate.
   *
   * @returns {Null}
   */
  none() {
    return Promise.resolve(null);
  },

  /**
   * Authenticate through user credentials.
   *
   * @returns {Object}
   */
  session(client) {
    const activeUser = client.getActiveUser();

    if (!isDefined(activeUser)) {
      return Promise.reject(
        new NoActiveUserError('There is not an active user. Please login a user and retry the request.')
      );
    }

    if (!isPlainObject(activeUser._kmd) || !isDefined(activeUser._kmd.authtoken)) {
      return Promise.reject(
        new NoActiveUserError('The active user does not have a valid auth token.')
      );
    }

    return Promise.resolve({
      scheme: 'Kinvey',
      credentials: activeUser._kmd.authtoken
    });
  }
};

function byteCount(str) {
  if (str) {
    let count = 0;
    const stringLength = str.length;
    str = String(str || '');

    for (let i = 0; i < stringLength; i += 1) {
      const partCount = encodeURI(str[i]).split('%').length;
      count += partCount === 1 ? 1 : partCount - 1;
    }

    return count;
  }

  return 0;
}

/**
 * @private
 */
export class Properties extends Headers { }

/**
 * @private
 */
export class KinveyRequest extends NetworkRequest {
  constructor(options = {}) {
    super(options);

    options = assign({
      skipBL: false,
      trace: false
    }, options);

    this.authType = options.authType || AuthType.None;
    this.query = options.query;
    this.aggregation = options.aggregation;
    this.properties = options.properties || new Properties();
    this.skipBL = options.skipBL === true;
    this.trace = options.trace === true;
    this.clientId = options.clientId;
    this.kinveyFileTTL = options.kinveyFileTTL;
    this.kinveyFileTLS = options.kinveyFileTLS;
  }

  static execute(options, client, dataOnly = true) {
    const o = assign({
      method: RequestMethod.GET,
      authType: AuthType.Default
    }, options);
    client = client || Client.sharedInstance();

    if (!o.url && isString(o.pathname) && client) {
      o.url = url.format({
        protocol: client.apiProtocol,
        host: client.apiHost,
        pathname: o.pathname
      });
    }

    let prm = new KinveyRequest(o).execute();
    if (dataOnly) {
      prm = prm.then(r => r.data);
    }
    return prm;
  }

  get appVersion() {
    return this.client.appVersion;
  }

  get query() {
    return this._query;
  }

  set query(query) {
    if (isDefined(query) && !(query instanceof Query)) {
      throw new KinveyError('Invalid query. It must be an instance of the Query class.');
    }

    this._query = query;
  }

  get aggregation() {
    return this._aggregation;
  }

  set aggregation(aggregation) {
    if (isDefined(aggregation) && !(aggregation instanceof Aggregation)) {
      throw new KinveyError('Invalid aggregation. It must be an instance of the Aggregation class.');
    }

    if (isDefined(aggregation)) {
      this.body = aggregation.toPlainObject();
    }

    this._aggregation = aggregation;
  }

  get headers() {
    const headers = super.headers;

    // Add the Accept header
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json; charset=utf-8');
    }

    // Add the Content-Type header
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json; charset=utf-8');
    }

    // Add the X-Kinvey-API-Version header
    if (!headers.has('X-Kinvey-Api-Version')) {
      headers.set('X-Kinvey-Api-Version', 4);
    }


    // Add or remove the X-Kinvey-Skip-Business-Logic header
    if (this.skipBL === true) {
      headers.set('X-Kinvey-Skip-Business-Logic', true);
    } else {
      headers.remove('X-Kinvey-Skip-Business-Logic');
    }

    // Add or remove the X-Kinvey-Include-Headers-In-Response and X-Kinvey-ResponseWrapper headers
    if (this.trace === true) {
      headers.set('X-Kinvey-Include-Headers-In-Response', 'X-Kinvey-Request-Id');
      headers.set('X-Kinvey-ResponseWrapper', true);
    } else {
      headers.remove('X-Kinvey-Include-Headers-In-Response');
      headers.remove('X-Kinvey-ResponseWrapper');
    }

    // Add or remove the X-Kinvey-Client-App-Version header
    if (this.appVersion) {
      headers.set('X-Kinvey-Client-App-Version', this.appVersion);
    } else {
      headers.remove('X-Kinvey-Client-App-Version');
    }

    // Add or remove X-Kinvey-Custom-Request-Properties header
    if (this.properties) {
      const customPropertiesHeader = this.properties.toString();

      if (!isEmpty(customPropertiesHeader)) {
        const customPropertiesByteCount = byteCount(customPropertiesHeader);

        if (customPropertiesByteCount >= 2000) {
          throw new Error(
            `The custom properties are ${customPropertiesByteCount} bytes.` +
            'It must be less then 2000 bytes.',
            'Please remove some custom properties.');
        }

        headers.set('X-Kinvey-Custom-Request-Properties', customPropertiesHeader);
      } else {
        headers.remove('X-Kinvey-Custom-Request-Properties');
      }
    } else {
      headers.remove('X-Kinvey-Custom-Request-Properties');
    }

    // Return the headers
    return headers;
  }

  set headers(headers) {
    super.headers = headers;
  }

  get url() {
    const urlString = super.url;
    let queryString = { kinveyfile_ttl: this.kinveyFileTTL, kinveyfile_tls: this.kinveyFileTLS };

    if (this.query) {
      queryString = Object.assign({}, queryString, this.query.toQueryString());
    }

    if (isEmpty(queryString)) {
      return urlString;
    }

    return appendQuery(urlString, qs.stringify(queryString));
  }

  set url(urlString) {
    super.url = urlString;
  }

  get properties() {
    return this._properties;
  }

  set properties(properties) {
    if (properties && (properties instanceof Properties) === false) {
      properties = new Properties(properties);
    }

    this._properties = properties;
  }

  getAuthorizationHeader(authType, client) {
    let promise = Promise.resolve(undefined);

    // Add or remove the Authorization header
    if (authType) {
      // Get the auth info based on the set AuthType
      switch (authType) {
        case AuthType.All:
          promise = Auth.all(client);
          break;
        case AuthType.App:
          promise = Auth.app(client);
          break;
        case AuthType.Basic:
          promise = Auth.basic(client);
          break;
        case AuthType.Client:
          promise = Auth.client(client, this.clientId);
          break;
        case AuthType.Master:
          promise = Auth.master(client);
          break;
        case AuthType.None:
          promise = Auth.none(client);
          break;
        case AuthType.Session:
          promise = Auth.session(client);
          break;
        default:
          promise = Auth.session(client)
            .catch((error) => {
              return Auth.master(client)
                .catch(() => {
                  throw error;
                });
            });
      }
    }

    return promise
      .then((authInfo) => {
        // Add the auth info to the Authorization header
        if (isDefined(authInfo)) {
          let { credentials } = authInfo;

          if (authInfo.username) {
            credentials = Buffer.from(`${authInfo.username}:${authInfo.password}`).toString('base64');
          }

          return `${authInfo.scheme} ${credentials}`;
        }

        return undefined;
      });
  }

   /** @returns {Promise} */
  execute(rawResponse = false, retry = true) {
    return this.getAuthorizationHeader(this.authType, this.client)
      .then((authorizationHeader) => {
        if (isDefined(authorizationHeader)) {
          this.headers.set('Authorization', authorizationHeader);
        } else {
          this.headers.remove('Authorization');
        }

      })
      .then(() => super.execute())
      .then((response) => {

        if ((response instanceof KinveyResponse) === false) {
          response = new KinveyResponse({
            statusCode: response.statusCode,
            headers: response.headers,
            data: response.data
          });
        }

        if (rawResponse === false && response.isSuccess() === false) {
          throw response.error;
        }

        return response;
      })
      .catch((error) => {
// <<<<<<< HEAD
        if (error instanceof InvalidCredentialsError) {
          // if (this.client._isRefreshing === true) {
          //   return new Promise(resolve => setTimeout(resolve, 250)).then(() => {
          //     this.lastRetry = true;
          //     return this.execute(rawResponse, false);
          //   });
          // }
          if (requestQueue.isPaused) {
            return requestQueue.add(() => this.execute(rawResponse, false));
          }

          requestQueue.pause();
          const activeUser = this.client.getActiveUser();

          if (this.lastRetry === true) {
            Log.debug('executing the last retry on this request before giving up', this.id);
            this.lastRetry = false;
            return this.execute(rawResponse, false);
          }

          if (retry) {
            const activeUser = this.client.getActiveUser();

            if (isDefined(activeUser)) {

              const socialIdentity = isDefined(activeUser._socialIdentity) ? activeUser._socialIdentity : {};
              const sessionKey = Object.keys(socialIdentity)
                .find(sessionKey => socialIdentity[sessionKey].identity === 'kinveyAuth');
              const oldSession = socialIdentity[sessionKey];


              if (isDefined(oldSession)) {
                this.client._isRefreshing = true;
                const request = new KinveyRequest({
                  method: RequestMethod.POST,
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  authType: AuthType.App,
                  url: url.format({
                    protocol: this.client.micProtocol,
                    host: this.client.micHost,
                    pathname: '/oauth/token'
                  }),
                  body: {
                    grant_type: 'refresh_token',
                    client_id: oldSession.client_id,
                    redirect_uri: oldSession.redirect_uri,
                    refresh_token: oldSession.refresh_token
                  },
                  properties: this.properties,
                  timeout: this.timeout
                });
                return request.execute()
                  .then(response => response.data)
                  .then((session) => {
                    session.identity = oldSession.identity;
                    session.client_id = oldSession.client_id;
                    session.redirect_uri = oldSession.redirect_uri;
                    session.protocol = this.client.micProtocol;
                    session.host = this.client.micHost;
                    return session;
                  })
                  .then((session) => {
                    const data = {};
                    socialIdentity[session.identity] = session;
                    data._socialIdentity = socialIdentity;

                    const request = new KinveyRequest({
                      method: RequestMethod.POST,
                      authType: AuthType.App,
                      url: url.format({
                        protocol: this.client.apiProtocol,
                        host: this.client.apiHost,
                        pathname: `/user/${this.client.appKey}/login`
                      }),
                      properties: this.properties,
                      body: data,
                      timeout: this.timeout,
                      client: this.client
                    });
                    return request.execute()
                      .then((response) => response.data)
                      .then((user) => {
                        user._socialIdentity[session.identity] = defaults(user._socialIdentity[session.identity], session);
                        this.client.refreshUserSubject.next(user);
                        return this.client.setActiveUser(user);
                      });
                  })
                  .then(() => {
                    requestQueue.start();
                    this.client._isRefreshing = false;
                    return this.execute(rawResponse, false);
                  })
                  .catch(err => {
                    Log.debug('caught error trying to refresh token');
                    this.client._isRefreshing = false;
                    this.client.refreshUserSubject.error(new InvalidCredentialsError('Cannot refresh session', this.id, 401));
                    this.client.refreshUserSubject = new Subject();
                    requestQueue.start();
                    return Promise.resolve(error);
                  });
              }
// =======
//         if (retry && error instanceof InvalidCredentialsError) {
//           if (requestQueue.isPaused) {
//             return requestQueue.add(() => this.execute(rawResponse, false));
//           }

//           requestQueue.pause();
//           const activeUser = this.client.getActiveUser();

//           if (isDefined(activeUser)) {
//             const socialIdentity = isDefined(activeUser._socialIdentity) ? activeUser._socialIdentity : {};
//             const sessionKey = Object.keys(socialIdentity)
//               .find(sessionKey => socialIdentity[sessionKey].identity === 'kinveyAuth');
//             const oldSession = socialIdentity[sessionKey];

//             if (isDefined(oldSession)) {
//               const request = new KinveyRequest({
//                 method: RequestMethod.POST,
//                 headers: {
//                   'Content-Type': 'application/x-www-form-urlencoded'
//                 },
//                 authType: AuthType.Client,
//                 url: url.format({
//                   protocol: this.client.micProtocol,
//                   host: this.client.micHost,
//                   pathname: '/oauth/token'
//                 }),
//                 body: {
//                   grant_type: 'refresh_token',
//                   client_id: oldSession.client_id,
//                   redirect_uri: oldSession.redirect_uri,
//                   refresh_token: oldSession.refresh_token
//                 },
//                 properties: this.properties,
//                 timeout: this.timeout,
//                 clientId: oldSession.client_id
//               });
//               return request.execute()
//                 .then(response => response.data)
//                 .then((session) => {
//                   session.identity = oldSession.identity;
//                   session.client_id = oldSession.client_id;
//                   session.redirect_uri = oldSession.redirect_uri;
//                   session.protocol = this.client.micProtocol;
//                   session.host = this.client.micHost;
//                   return session;
//                 })
//                 .then((session) => {
//                   const data = {};
//                   socialIdentity[session.identity] = session;
//                   data._socialIdentity = socialIdentity;

//                   const request = new KinveyRequest({
//                     method: RequestMethod.POST,
//                     authType: AuthType.App,
//                     url: url.format({
//                       protocol: this.client.apiProtocol,
//                       host: this.client.apiHost,
//                       pathname: `/user/${this.client.appKey}/login`
//                     }),
//                     properties: this.properties,
//                     body: data,
//                     timeout: this.timeout,
//                     client: this.client
//                   });
//                   return request.execute()
//                     .then((response) => response.data)
//                     .then((user) => {
//                       user._socialIdentity[session.identity] = defaults(user._socialIdentity[session.identity], session);
//                       return this.client.setActiveUser(user);
//                     });
//                 })
//                 .then(() => {
//                   requestQueue.start();
//                   return this.execute(rawResponse, false);
//                 })
//                 .catch(() => {
//                   requestQueue.start();
//                   return Promise.reject(error);
//                 });
// >>>>>>> upstream/MLIBZ-2585
            }
          } else {
            Log.debug('not retrying request with request id', this.id);
            return Promise.reject(new InvalidCredentialsError('refresh process did not work, sending the user out of the app', this.id, 401));
          }
// <<<<<<< HEAD
//         } else if (retry && error instanceof InvalidGrantError) {
//           Log.debug('caught invalid grant error');
//           this.client._isRefreshing = false;
//           this.client.refreshUserSubject.error(new InvalidCredentialsError('Cannot refresh session', this.id, 401));
//           this.client.refreshUserSubject = new Subject();
//           return Promise.resolve(error);
//         } else if (!retry && error.statusCode >= 500) {
//           Log.debug('caught a 500 after refresh, log em out');
//           this.client._isRefreshing = false;
//           this.client.refreshUserSubject.error(new InvalidCredentialsError('Cannot refresh session', this.id, 401));
//           this.client.refreshUserSubject = new Subject();
// =======

          requestQueue.start();
          return Promise.reject(error);
// >>>>>>> upstream/MLIBZ-2585
        }

        return Promise.reject(error);
      });
  }
}
