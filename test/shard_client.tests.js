const ShardClient = require('../shard_client');
const assert      = require('chai').assert;
const _           = require('lodash');
const mockuire    = require('mockuire')(module);

describe('ShardClient', function() {
  it('should fail if shard is not specified', function() {
    assert.throws(() => new ShardClient(), /shard is required/);
    assert.throws(() => new ShardClient({}), /shard is required/);
  });

  function ShardClientCtor(client) {
    return mockuire('../shard_client', {
      './client': client
    });
  }

  it('should work when full url are provided', function() {
    const client = function(params) {
      this.host = params.host;
    };

    const ShardClient = ShardClientCtor(client);

    const shardClient = new ShardClient({
      shard: { hosts: [ 'limitd://host-2:9231', 'limitd://host-1:9231' ] }
    });

    assert.equal(shardClient.clients[0].host, 'limitd://host-1:9231');
    assert.equal(shardClient.clients[1].host, 'limitd://host-2:9231');
  });

  it('should create a new client for each host', function() {
    const client = function(params) {
      this.host = params.host;
    };

    const ShardClient = ShardClientCtor(client);

    const shardClient = new ShardClient({
      shard: { hosts: [ 'host-2', 'host-1' ] }
    });

    assert.equal(shardClient.clients[0].host, 'limitd://host-1:9231');
    assert.equal(shardClient.clients[1].host, 'limitd://host-2:9231');
  });

  ['take', 'put', 'wait', 'status', 'on', 'once', 'ping'].forEach(method => {
    it(`should define ${method}`, function() {
      const shardClient = new ShardClient({
        client: ()=>{},
        shard: { hosts: [ 'host-1', 'host-2' ] }
      });
      assert.isFunction(shardClient[method]);
    });
  });


  it('should invoke PUT on the client based on the hash', function(done) {
    const client = function(params) {
      this.host = params.host;
      this.put = function(type, key, count, callback) {
        assert.equal(this.host, 'limitd://host-2:9231');
        assert.equal(type, 'ip');
        assert.equal(key, '10.0.0.1');
        assert.equal(count, 1);
        assert.isFunction(callback);
        done();
      };
    };

    const ShardClient = ShardClientCtor(client);

    const shardClient = new ShardClient({
      client,
      shard: { hosts: [ 'host-1', 'host-2' ] }
    });

    shardClient.put('ip', '10.0.0.1', 1, _.noop);
  });

  it('should invoke TAKE on the client based on the hash', function(done) {
    const client = function(params) {
      this.host = params.host;
      this.take = function(type, key, count, callback) {
        assert.equal(this.host, 'limitd://host-1:9231');
        assert.equal(type, 'ip');
        assert.equal(key, '10.0.0.2');
        assert.equal(count, 1);
        assert.isFunction(callback);
        done();
      };
    };

    const ShardClient = ShardClientCtor(client);

    const shardClient = new ShardClient({
      shard: { hosts: [ 'host-1', 'host-2' ] }
    });

    shardClient.take('ip', '10.0.0.2', 1, _.noop);
  });

  it('should invoke PUT on the client based on the hash (2)', function(done) {
    const client = function(params) {
      this.host = params.host;
      this.put = function(type, key, count, callback) {
        assert.equal(this.host, 'limitd://host-1:9231');
        assert.equal(type, 'ip');
        assert.equal(key, '10.0.0.2');
        assert.equal(count, 1);
        assert.isFunction(callback);
        done();
      };
    };

    const ShardClient = ShardClientCtor(client);

    const shardClient = new ShardClient({
      shard: { hosts: [ 'host-1', 'host-2' ] }
    });

    shardClient.put('ip', '10.0.0.2', 1, _.noop);
  });

  it('should call every host on status', function(done) {
    const client = function(params) {
      this.host = params.host;
      this.status = function(type, prefix, callback) {
        callback(null, {
          items: [
            `item1-from-${this.host}`,
            `item2-from-${this.host}`
          ]
        });
      };
    };

    const ShardClient = ShardClientCtor(client);

    const shardClient = new ShardClient({
      shard: { hosts: [ 'host-1', 'host-2' ] }
    });

    shardClient.status('ip', '10.0.0.2', (err, response) => {
      if (err) { return done(err); }
      assert.include(response.items, 'item1-from-limitd://host-1:9231');
      assert.include(response.items, 'item2-from-limitd://host-1:9231');
      assert.include(response.items, 'item1-from-limitd://host-2:9231');
      assert.include(response.items, 'item2-from-limitd://host-2:9231');
      done();
    });
  });

  it('should swallow error from client on status', function(done) {
    const client = function(params) {
      this.host = params.host;
      this.status = function(type, prefix, callback) {
        if (this.host === 'limitd://host-2:9231') {
          return callback(new Error('unreachable'));
        }
        callback(null, {
          items: [
            `item1-from-${this.host}`,
            `item2-from-${this.host}`
          ]
        });
      };
    };

    const ShardClient = ShardClientCtor(client);

    const shardClient = new ShardClient({
      shard: { hosts: [ 'host-1', 'host-2' ] }
    });

    shardClient.status('ip', '10.0.0.2', (err, response) => {
      if (err) { return done(err); }
      assert.equal(response.errors[0].message, 'unreachable');
      assert.include(response.items, 'item1-from-limitd://host-1:9231');
      assert.include(response.items, 'item2-from-limitd://host-1:9231');
      assert.notInclude(response.items, 'item1-from-limitd://host-2:9231');
      assert.notInclude(response.items, 'item2-from-limitd://host-2:9231');
      done();
    });
  });

  it('should ping all hosts on ping', function(done) {
    const pinged = [];
    const client = function(params) {
      this.host = params.host;
      this.ping = function(callback) {
        pinged.push(this.host);
        callback(null, {});
      };
    };

    const ShardClient = ShardClientCtor(client);

    const shardClient = new ShardClient({
      shard: { hosts: [ 'host-1', 'host-2' ] }
    });

    shardClient.ping((err) => {
      if (err) { return done(err); }
      assert.equal(pinged[0], 'limitd://host-1:9231');
      assert.equal(pinged[1], 'limitd://host-2:9231');
      done();
    });
  });


  it('should autodiscover limitd shards', function() {
    const client = function(params) {
      this.host = params.host;
    };

    const dns = {
      resolve: (address, type, callback) => {
        assert.equal(address, 'foo.bar.company.example.com');
        assert.equal(type, 'A');
        callback(null, [ 'host-b', 'host-a' ]);
      }
    };

    const SharedClient = mockuire('../shard_client', {
      './client': client,
      'dns': dns
    });

    const shardClient = new SharedClient({
      shard: {
        autodiscover: {
          address: 'foo.bar.company.example.com'
        }
      }
    });

    assert.equal(shardClient.clients[0].host, 'limitd://host-a:9231');
    assert.equal(shardClient.clients[1].host, 'limitd://host-b:9231');
  });


});
