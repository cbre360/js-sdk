import StatusCode from '../enums/statusCode';
const privateResponseSymbol = Symbol();

class PrivateResponse {
  constructor(statusCode = StatusCode.OK, headers = {}, data = {}) {
    // Set response info
    this.statusCode = statusCode;
    this.headers = {};
    this.data = data;

    // Add headers
    this.addHeaders(headers);
  }

  getHeader(header) {
    const keys = Object.keys(this.headers);

    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];

      if (key.toLowerCase() === header.toLowerCase()) {
        return this.headers[key];
      }
    }

    return undefined;
  }

  setHeader(header, value) {
    const headers = this.headers || {};
    header = header.toLowerCase();
    headers[header] = value;
    this.headers = headers;
  }

  addHeaders(headers) {
    const keys = Object.keys(headers);

    keys.forEach((header) => {
      const value = headers[header];
      this.setHeader(header, value);
    });
  }

  isSuccess() {
    return this.statusCode >= 200 && this.statusCode < 300;
  }

  toJSON() {
    const json = {
      statusCode: this.statusCode,
      headers: this.headers,
      data: this.data
    };

    // Return the json object
    return json;
  }
}

class Response {
  constructor(statusCode = StatusCode.OK, headers = {}, data = {}) {
    // Create a private response
    this[privateResponseSymbol] = new PrivateResponse(statusCode, headers, data);
  }

  get statusCode() {
    const privateResponse = this[privateResponseSymbol];
    return privateResponse.statusCode;
  }

  get data() {
    const privateResponse = this[privateResponseSymbol];
    return privateResponse.data;
  }

  set data(data) {
    const privateResponse = this[privateResponseSymbol];
    privateResponse.data = data;
  }

  getHeader(header) {
    const privateResponse = this[privateResponseSymbol];
    return privateResponse.getHeader(header);
  }

  isSuccess() {
    const privateResponse = this[privateResponseSymbol];
    return privateResponse.isSuccess();
  }

  toJSON() {
    const privateResponse = this[privateResponseSymbol];
    return privateResponse.toJSON();
  }
}

export default Response;
