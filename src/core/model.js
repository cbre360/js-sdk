import Kinvey from '../kinvey';
import Acl from './acl';
import Metadata from './metadata';
import defaults from 'lodash/object/defaults';
import result from 'lodash/object/result';
import cloneDeep from 'lodash/lang/cloneDeep';
import assign from 'lodash/object/assign';
import has from 'lodash/object/has';
import size from 'lodash/collection/size';
import uniqueId from 'lodash/utility/uniqueId';
import isEqual from 'lodash/lang/isEqual';
import isEmpty from 'lodash/lang/isEmpty';
import isDefined from '../utils/isDefined';

class Model {
  get cidPrefix() {
    return 'c';
  }

  get idAttribute() {
    return '_id';
  }

  get id() {
    return this.get(this.idAttribute);
  }

  get acl() {
    return new Acl(this.get('_acl'));
  }

  get metadata() {
    return new Metadata(this.get('_kmd'));
  }

  get defaults() {
    return {
      _acl: {},
      _kmd: {}
    };
  }

  constructor(attributes = {}, options = {}) {
    // Set default options
    options = defaults({}, options, {
      client: Kinvey.toJSON()
    });

    this.cid = uniqueId(this.cidPrefix);
    this.client = options.client;
    this.attributes = {};
    this.changed = {};
    this.validationError = null;

    let attrs = attributes;
    if (options.parse) {
      attrs = this.parse(attrs, options) || {};
    }

    attrs = defaults({}, attrs, result(this, 'defaults', {}));
    this.set(attrs, options);
  }

  toJSON() {
    return cloneDeep(this.attributes);
  }

  get(attr) {
    return this.attributes[attr];
  }

  has(attr) {
    return isDefined(this.get(attr));
  }

  set(key, val, options = {}) {
    if (!isDefined(key)) {
      return this;
    }

    // Handle both `key, value` and `{key: value}` style arguments
    let attrs;
    if (typeof key === 'object') {
      attrs = key;
      options = val;
    } else {
      (attrs = {})[key] = val;
    }

    // Run validation
    if (!this._validate(attrs, options)) {
      return false;
    }

    // Extract attributes and options
    const unset = options.unset;
    const changes = [];
    const changing = this._changing;
    this._changing = true;

    if (!changing) {
      this._previousAttributes = cloneDeep(this.attributes);
      this.changed = {};
    }

    const currentAttributes = this.attributes;
    const changed = this.changed;
    const previousAttributes = this._previousAttributes;

    // For each `set` attribute. update or delete the current value
    for (const attr in attrs) {
      if (attrs.hasOwnProperty(attr)) {
        val = attrs[attr];

        if (!isEqual(currentAttributes[attr], val)) {
          changes.push(attr);
        }

        if (!isEqual(previousAttributes[attr], val)) {
          changed[attr] = val;
        } else {
          delete changed[attr];
        }

        if (unset) {
          delete currentAttributes[attr];
        } else {
          currentAttributes[attr] = val;
        }
      }
    }

    this._changing = false;
    return this;
  }

  unset(attr, options = {}) {
    return this.set(attr, undefined, assign({}, options, { unset: true }));
  }

  hasChanged(attr) {
    if (!isDefined(attr)) {
      return !isEmpty(this.changed);
    }

    return has(this.changed, attr);
  }

  changedAttributes(diff) {
    if (!diff) {
      return this.hasChanged() ? cloneDeep(this.changed) : false;
    }

    const old = this._changing ? this._previousAttributes : this.attributes;
    const changed = {};

    for (const attr in diff) {
      if (diff.hasOwnProperty(attr)) {
        const val = diff[attr];

        if (isEqual(old[attr], val)) {
          continue;
        }

        changed[attr] = val;
      }
    }

    return size(changed) ? changed : false;
  }

  previousAttribute(attr) {
    if (!isDefined(attr) || !this._previousAttributes) {
      return null;
    }

    return this._previousAttributes[attr];
  }

  parse(data) {
    return data;
  }

  isNew() {
    return !this.has(this.idAttribute);
  }

  isValid(options = {}) {
    return this._validate({}, defaults({ validate: true }, options));
  }

  _validate(attrs, options = {}) {
    if (!options.validate || !this.validate) {
      return true;
    }

    attrs = assign({}, this.attributes, attrs);
    const error = this.validationError = this.validate(attrs, options) || null;

    if (error) {
      return false;
    }

    return true;
  }
}

export default Model;
