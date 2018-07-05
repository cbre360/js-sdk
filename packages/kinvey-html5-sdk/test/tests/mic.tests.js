function testFunc() {

  //the same redirect url should be configured on the server
  const serverHost = 'auth.kinvey.com';
  const redirectUrl = 'http://localhost:64320/callback';
  const { authServiceId } = externalConfig;
  const { wrongSetupAuthServiceId } = externalConfig;
  const micDefaultVersion = 'v3';

  //the used OAuth 2 provider is Facebook
  const { fbEmail } = externalConfig;
  const { fbPassword } = externalConfig;
  const fbDevUrl = 'https://developers.facebook.com';
  const fbUserName = 'Test User Facebook';
  const fbCookieName = 'c_user';
  const fbCookieValue = '1172498488';

  const { collectionName } = externalConfig;
  const networkstore = Kinvey.DataStore.collection(collectionName, Kinvey.DataStoreType.Network);


  // The configured access_token ttl is 3 seconds on the server for the default auth service
  const defaultServiceAccessTokenTTL = 3000;

  // Currently the server returns refresh_token = 'null' if the auth service does not allow refresh tokens.
  // The tests should be changed when this is fixed on the server
  const notAllowedRefreshTokenValue = 'null';
  const invalidUrl = 'invalid_url';
  const shouldNotBeInvokedMessage = 'Should not happen';
  const cancelledLoginMessage = 'Login has been cancelled.';
  let winOpen;
  let actualHref;

  const getExpectedInitialUrl = (appKey, micVersion, redirectUrl) => {
    return `https://${serverHost}/${micVersion}/oauth/auth?client_id=${appKey}&redirect_uri=${redirectUrl}&response_type=code&scope=openid`;
  };

  const validateSuccessfulDataRead = (done) => {
    return networkstore.find().toPromise()
      .then((result) => {
        expect(result).to.be.an('array');
        done();
      });
  };

  const expireFBCookie = (fbWindow, cookieName, cookieValue, expiredDays) => {
    const newDate = new Date();
    newDate.setTime(newDate.getTime() - (expiredDays * 24 * 60 * 60 * 1000));
    const expires = 'expires=' + newDate.toUTCString();
    const domain = 'domain=.facebook.com';
    const newValue = `${cookieName}=${cookieValue};${expires};${domain};path=/`;
    fbWindow.document.cookie = newValue;
  };

  const validateMICUser = (user, allowRefreshTokens, explicitAuthServiceId) => {
    expect(user).to.deep.equal(Kinvey.User.getActiveUser());

    const userData = user.data;
    const kinveyAuth = userData._socialIdentity.kinveyAuth;
    const metadata = userData._kmd;

    expect(userData._id).to.exist;
    expect(userData.username).to.exist;
    expect(userData._acl.creator).to.exist;
    expect(metadata.lmt).to.exist;
    expect(metadata.ect).to.exist;
    expect(metadata.authtoken).to.exist;

    expect(kinveyAuth.id).to.exist;
    expect(kinveyAuth.name).to.equal(fbUserName);
    expect(kinveyAuth.access_token).to.exist;

    if (allowRefreshTokens) {
      expect(typeof kinveyAuth.refresh_token).to.equal('string');
      expect(kinveyAuth.refresh_token).to.not.equal(notAllowedRefreshTokenValue);
    }
    else {
      expect(kinveyAuth.refresh_token).to.equal(notAllowedRefreshTokenValue);
    }

    expect(kinveyAuth.token_type).to.equal('Bearer');
    expect(typeof kinveyAuth.expires_in).to.equal('number');
    expect(kinveyAuth.id_token).to.exist;
    expect(kinveyAuth.identity).to.equal('kinveyAuth');
    if (explicitAuthServiceId) {
      expect(kinveyAuth.client_id).to.equal(`${externalConfig.appKey}.${authServiceId}`);
    }
    else {
      expect(kinveyAuth.client_id).to.equal(externalConfig.appKey);
    }
    expect(kinveyAuth.redirect_uri).to.equal(redirectUrl);
    expect(kinveyAuth.protocol).to.equal('https:');
    expect(kinveyAuth.host).to.equal(serverHost);

    expect(user.client).to.exist;
  };

  const addLoginFacebookHandler = () => {
    // monkey patch window.open - the function is reset back in the afterEach hook
    window.open = function () {
      const fbPopup = winOpen.apply(this, arguments);
      fbPopup.addEventListener('load', function () {
        const setIntervalVar = setInterval(function () {
          const email = fbPopup.document.getElementById('email')
          const pass = fbPopup.document.getElementById('pass')
          const loginButton = fbPopup.document.getElementById('loginbutton')
          if (email && pass && loginButton) {
            email.value = fbEmail;
            pass.value = fbPassword;
            loginButton.click();
            clearInterval(setIntervalVar);
          }
        }, 1000);
      });
      return fbPopup;
    };
  };

  const addCloseFacebookPopupHandler = (retrievePopupUrl) => {
    window.open = function () {
      const fbPopup = winOpen.apply(this, arguments);
      fbPopup.addEventListener('load', function () {
        if (retrievePopupUrl) {
          actualHref = fbPopup.location.href;
        }
        fbPopup.close();
      });
      return fbPopup;
    };
  };

  const resolveAfter = (timeInMs) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, timeInMs);
    });
  }

  describe('MIC Integration', () => {

    beforeEach((done) => {
      Kinvey.User.logout()
        .then(() => {
          var fbWindow = window.open(fbDevUrl);
          fbWindow.addEventListener('load', function () {
            expireFBCookie(fbWindow, fbCookieName, fbCookieValue, 3);
            fbWindow.close();
            winOpen = window.open;
            actualHref = null;
            done();
          });
        });
    });

    afterEach((done) => {
      window.open = winOpen;
      done();
    });


    it('should login the user, using the default Auth service, which allows refresh tokens', (done) => {
      addLoginFacebookHandler();
      Kinvey.User.loginWithMIC(redirectUrl)
        .then((user) => {
          validateMICUser(user, true);
          return Kinvey.User.exists(user.username)
        })
        .then((existsOnServer) => {
          expect(existsOnServer).to.be.true;
          return validateSuccessfulDataRead(done);
        })
        .catch(done);
    });

    it('should login the user, using the specified Auth service, which does not allow refresh tokens', (done) => {
      addLoginFacebookHandler();
      Kinvey.User.loginWithMIC(redirectUrl, Kinvey.AuthorizationGrant.AuthorizationCodeLoginPage, { micId: authServiceId })
        .then((user) => {
          validateMICUser(user, false, true);
          return validateSuccessfulDataRead(done);
        })
        .catch(done);
    });

    it('should refresh an expired access_token and not logout the user', (done) => {
      addLoginFacebookHandler();
      Kinvey.User.loginWithMIC(redirectUrl)
        .then((user) => {
          expect(user).to.exist;

          // the test waits for the expiration of the access_token 
          return resolveAfter(defaultServiceAccessTokenTTL + 100)
        })
        .then(() => {
          return validateSuccessfulDataRead(done);
        })
        .catch(done);
    });

    it(`should make a correct request to KAS with the default ${micDefaultVersion} version`, (done) => {
      // Currently the error function is not called when the redirect url is invalid,
      // so the test is closing the popup in order to resume execution and validate the request url  
      addCloseFacebookPopupHandler(true);

      Kinvey.User.loginWithMIC(invalidUrl)
        .then(() => done(new Error(shouldNotBeInvokedMessage)))
        .catch(() => {
          expect(actualHref).to.equal(getExpectedInitialUrl(externalConfig.appKey, micDefaultVersion, invalidUrl));
          done();
        }).catch(done);
    });

    it(`should make a correct request to KAS with the supplied options.version`, (done) => {
      // Currently the error function is not called when the redirect url is invalid,
      // so the test is closing the popup in order to resume execution and validate the request url 
      const submittedVersion = 'v2';
      addCloseFacebookPopupHandler(true);

      Kinvey.User.loginWithMIC(invalidUrl, Kinvey.AuthorizationGrant.AuthorizationCodeLoginPage, { version: submittedVersion })
        .then(() => done(new Error(shouldNotBeInvokedMessage)))
        .catch(() => {
          expect(actualHref).to.equal(getExpectedInitialUrl(externalConfig.appKey, submittedVersion, invalidUrl));
          done();
        }).catch(done);
    });

    it('should throw an error if the user cancels the login', (done) => {
      addCloseFacebookPopupHandler();

      Kinvey.User.loginWithMIC(redirectUrl)
        .then(() => done(new Error(shouldNotBeInvokedMessage)))
        .catch((err) => {
          expect(err.message).to.equal(cancelledLoginMessage);
          done();
        }).catch(done);
    });

    it('should throw an error if the authorization grant is invalid', (done) => {
      addLoginFacebookHandler();
      Kinvey.User.loginWithMIC(redirectUrl, 'InvalidAuthorizationGrant', { micId: authServiceId })
        .then(() => done(new Error(shouldNotBeInvokedMessage)))
        .catch((err) => {
          expect(err.message).to.contain('Please use a supported authorization grant.');
          done();
        }).catch(done);
    });

    it('should throw an error if an active user already exists', (done) => {
      addLoginFacebookHandler();
      Kinvey.User.signup()
        .then(() => {
          return Kinvey.User.loginWithMIC(redirectUrl)
        })
        .then(() => done(new Error(shouldNotBeInvokedMessage)))
        .catch((err) => {
          expect(err.message).to.contain('An active user already exists.');
          done();
        }).catch(done);
    });

    it('should return the error from the Oauth provider with the default MIC version', (done) => {
      addLoginFacebookHandler();
      Kinvey.User.loginWithMIC(redirectUrl, Kinvey.AuthorizationGrant.AuthorizationCodeLoginPage, { micId: wrongSetupAuthServiceId })
        .then(() => done(new Error(shouldNotBeInvokedMessage)))
        .catch((err) => {
          expect(err.name).to.equal('KinveyError');
          expect(err.message).to.equal('server_error');
          expect(err.debug).to.contain('OAuth provider returned an error when trying to retrieve the token');
          done();
        }).catch(done);
    });
  });
}

runner.run(testFunc);
