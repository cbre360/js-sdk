import Promise from 'es6-promise';
import { KinveyError } from './errors';
import { isDefined } from './utils';
import { Client } from './client';
import { User } from './user';
import { AuthType, RequestMethod, KinveyRequest } from './request';

/**
 * @private
 *
 * Returns the shared instance of the Client class used by the SDK.
 *
 * @throws {KinveyError} If a shared instance does not exist.
 *
 * @return {Client} The shared instance.
 *
 * @example
 * var client = Kinvey.client;
 */
function getClient() {
  return Client.sharedInstance();
}
export { getClient as client };

/**
 * The version of your app. It will sent with Network API requests
 * using the `X-Kinvey-Api-Version` header.
 *
 * @return {string} The version of your app.
 *
 * @example
 * var appVersion = Kinvey.getAppVersion();
 */
export function getAppVersion() {
  const client = getClient();

  if (client) {
    return client.appVersion;
  }

  return undefined;
}

/**
 * Set the version of your app. It will be sent with Network API requests
 * using the X-Kinvey-Api-Version header.
 *
 * @param {string} appVersion App version.
 *
 * @example
 * Kinvey.setAppVersion('1.0.0');
 * // or
 * Kinvey.setAppVersion('v1');
 */
export function setAppVersion(appVersion) {
  const client = getClient();

  if (client) {
    client.appVersion = appVersion;
  }
}

/**
 * Initializes the SDK with your app's configuration.
 *
 * @param {Object}    options                                            Options
 * @param {string}    [options.instanceId='<my-subdomain>']              Custom subdomain for Kinvey API and MIC requests.
 * @param {string}    [options.apiHostname='https://baas.kinvey.com']    Deprecated: Use options.instanceId instead.
 * @param {string}    [options.micHostname='https://auth.kinvey.com']    Deprecated: Use options.instanceId instead.
 * @param {string}    [options.appKey]                                   App Key
 * @param {string}    [options.appSecret]                                App Secret
 * @param {string}    [options.appVersion]                               App Version
 * @return {Object}                                                      Your app's configuration.
 *
 * @throws  {KinveyError}  If an `options.appKey` is not provided.
 * @throws  {KinveyError}  If an `options.appSecret` is not provided.
 */
export function init(options = {}) {
  // Check that an appKey or appId was provided
  if (isDefined(options.appKey) === false) {
    throw new KinveyError('No App Key was provided.'
      + ' Unable to create a new Client without an App Key.');
  }

  // Check that an appSecret or masterSecret was provided
  if (isDefined(options.appSecret) === false && isDefined(options.masterSecret) === false) {
    throw new KinveyError('No App Secret or Master Secret was provided.'
      + ' Unable to create a new Client without an App Secret.');
  }

  // Initialize the client
  return Client.init(options);
}

 /**
 * Initializes the SDK with your app's information. The SDK is initialized when the returned
 * promise resolves.
 *
 * @param {Object}    options                                            Options
 * @param {string}    [options.instanceId='<my-subdomain>']              Custom subdomain for Kinvey API and MIC requests.
 * @param {string}    [options.apiHostname='https://baas.kinvey.com']    Deprecated: Use options.instanceId instead.
 * @param {string}    [options.micHostname='https://auth.kinvey.com']    Deprecated: Use options.instanceId instead.
 * @param {string}    [options.appKey]                                   App Key
 * @param {string}    [options.appSecret]                                App Secret
 * @param {string}    [options.appVersion]                               App Version
 * @return {Promise}                                                     A promise.
 *
 * @throws  {KinveyError}  If an `options.appKey` is not provided.
 * @throws  {KinveyError}  If neither an `options.appSecret` or `options.masterSecret` is provided.
 *
 * @deprecated Please use init().
 */
export function initialize(config) {
  try {
    const client = init(config);
    return Promise.resolve(User.getActiveUser(client));
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Pings the Kinvey API service. This can be used to check if you have configured the SDK correctly.
 *
 * @returns {Promise<Object>} The response from the ping request.
 *
 * @example
 * var promise = Kinvey.ping()
 *  .then(function(response) {
 *     console.log('Kinvey Ping Success. Kinvey Service is alive, version: ' + response.version + ', response: ' + response.kinvey);
 *  })
 *  .catch(function(error) {
 *    console.log('Kinvey Ping Failed. Response: ' + error.description);
 *  });
 */
export function ping() {
  const client = getClient();
  const request = new KinveyRequest({
    method: RequestMethod.GET,
    authType: AuthType.All,
    url: `${client.apiHostname}/appdata/${client.appKey}`,
  });

  return request.execute()
    .then(response => response.data);
}
