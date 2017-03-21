const LimitdClient = require('./client');
const EventEmitter = require('events').EventEmitter;

const _      = require('lodash');
const murmur = require('murmurhash3js').x86.hash32;
const async  = require('async');
const dns    = require('dns');
const util   = require('util');

const REFRESH_AFTER_MS = 1000 * 60 * 5;

const defaults = {
  port: 9231
};

function ShardClient(options) {
  if (typeof options !== 'object' || typeof options.shard !== 'object') {
    throw new Error('shard is required');
  }

  EventEmitter.call(this);

  this._options = _.extend({}, defaults, options);
  this._clientParams = _.omit(this._options, ['shard', 'port']);

  if (Array.isArray(this._options.shard.hosts)) {
    this.hostCount = this._options.shard.hosts.length;
    this.clients = _.sortBy(this._options.shard.hosts).map(host => this.createClient(host));
  } else if (this._options.shard.autodiscover) {
    this.autodiscover = this._options.shard.autodiscover;
    this.clients = [];
    this.currentHosts = [];
    this.discover();
  } else {
    throw new Error('unsupported shard configuration');
  }
}

util.inherits(ShardClient, EventEmitter);


ShardClient.prototype.createClient = function(host) {
  const client = new LimitdClient(_.extend(this._clientParams, { host }));
  if (client instanceof EventEmitter) {
    //map the events from LimitdClient.
    //Last parameter is always the underlying client.
    client.on('error',         (err) => this.emit('error', err, client))
          .on('breaker_error', (err) => this.emit('breaker_error', err, client))
          .on('connect',       ()    => this.emit('connect', client))
          .on('reconnect',     ()    => this.emit('reconnect', client))
          .on('close',         ()    => this.emit('close', client))
          .on('ready',         ()    => this.emit('ready', client))
          .on('response',      (r)   => this.emit('response', r, client));
  }
  return client;
};

ShardClient.prototype.discover = function() {
  dns.resolve(this.autodiscover.address, this.autodiscover.type || 'A', (err, addresses) => {
    setTimeout(() => this.discover(), REFRESH_AFTER_MS);
    if (err) {
      return this.emit('error', err);
    }

    const newList = _.sortBy(addresses)
                     .map(ip => `limitd://${ip}:${this._options.port}`);

    if (_.isEqual(newList, this.currentHosts)) {
      //the list hasn't changed
      return;
    }

    this.currentHosts = newList;

    this.clients.forEach(c => c.disconnect());

    this.hostCount = this.currentHosts.length;

    this.clients = this.currentHosts.map(host => this.createClient(host));
  });
};

ShardClient.prototype.getDestinationClient = function(type, key) {
  const index =  murmur(`${type}:${key}`) % this.hostCount;
  return this.clients[index];
};

['reset', 'put', 'take', 'wait'].forEach(method => {
  ShardClient.prototype[method] = function(type, key) {
    const client = this.getDestinationClient(type, key);
    return client[method].apply(client, arguments);
  };
});

ShardClient.prototype.status = function(type, prefix, callback) {
  async.map(this.clients, (client, callback) => {
    client.status(type, prefix, (err, response) => {
      if (err) {
        return callback(null, { error: err });
      }
      callback(null, response);
    });
  }, (err, responses) => {
    if (err) { return callback(err); }

    callback(null, {
      items:  _.flatten(responses.map(r => r.items).filter(Array.isArray)),
      errors: responses.map(r => r.error).filter(e => e)
    });
  });
};


module.exports = ShardClient;