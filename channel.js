const socketClusterClient = require('socketcluster-client');
const AsyncStreamEmitter = require('async-stream-emitter');

class Channel extends AsyncStreamEmitter {
  constructor(options = {}) {
    super();

    let {dependencies, dependents, modulePathFunction} = options;
    this.dependencies = dependencies || [];
    this.dependents = dependents;
    this.clients = {};
    for (let moduleName of this.dependencies) {
      let client = socketClusterClient.create({
        protocolScheme: 'ws+unix',
        socketPath: modulePathFunction(moduleName)
      });

      (async () => {
        for await (let event of client.listener('connect')) {
          console.log('CONNECT!!!! TODO 2');
        }
      })();

      (async () => {
        for await (let {error} of client.listener('error')) {
          this.emit('error', {error});
        }
      })();

      this.clients[moduleName] = client;
    }
  }

  subscribe(channelName, handler) {

  }

  publish(channelName, data) {

  }

  invoke(actionName, data) {

  }
}

module.exports = Channel;
