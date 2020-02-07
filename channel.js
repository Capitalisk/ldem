const socketClusterClient = require('socketcluster-client');
const AsyncStreamEmitter = require('async-stream-emitter');

class Channel extends AsyncStreamEmitter {
  constructor(options = {}) {
    super();

    let {
      moduleName,
      dependencies,
      dependents,
      redirects,
      modulePathFunction,
      exchange,
      subscribeTimeout,
      defaultTargetModuleName
    } = options;

    this.exchange = exchange;
    this.moduleName = moduleName;
    this.dependencies = dependencies || [];
    this.dependents = dependents;
    this.redirects = redirects;
    this.clients = {};
    this.subscribeTimeout = subscribeTimeout;
    this._dependencyLookup = {};

    for (let dependencyName of this.dependencies) {
      if (this.redirects[dependencyName] != null) {
        dependencyName = this.redirects[dependencyName];
      }
      this._dependencyLookup[dependencyName] = true;
      let client = socketClusterClient.create({
        protocolScheme: 'ws+unix',
        socketPath: modulePathFunction(dependencyName)
      });

      (async () => {
        for await (let {error} of client.listener('error')) {
          this.emit('error', {error});
        }
      })();

      this.clients[dependencyName] = client;
    }
  }

  async subscribe(channel, handler) {
    let {targetModuleName} = this._getCommandParts(channel);
    if (!this._dependencyLookup[targetModuleName]) {
      let error = new Error(
        `Cannot subscribe to the ${
          channel
        } channel on the ${
          targetModuleName
        } module because it is not listed as a dependency of the ${
          this.moduleName
        } module`
      );
      error.name = 'InvalidTargetModuleError';
      throw error;
    }
    let channelObject = this.clients[targetModuleName].subscribe(channel);
    let channelDataConsumer = channelObject.createConsumer();
    handler.channelOutputConsumerId = channelDataConsumer.id;

    (async () => {
      while (true) {
        let packet = await channelDataConsumer.next();
        if (packet.done) break;
        let event = packet.value;
        try {
          await handler(event);
        } catch (error) {
          this.emit('error', {error});
        }
      }
    })();
    return channelObject.listener('subscribe').once(this.subscribeTimeout);
  }

  unsubscribe(channel, handler) {
    let {targetModuleName} = this._getCommandParts(channel);
    if (!this._dependencyLookup[targetModuleName]) {
      let error = new Error(
        `Cannot unsubscribe from the ${
          channel
        } channel on the ${
          targetModuleName
        } module because it is not listed as a dependency of the ${
          this.moduleName
        } module`
      );
      error.name = 'InvalidTargetModuleError';
      throw error;
    }
    let targetClient = this.clients[targetModuleName];
    let targetChannel = targetClient.channel(channel);
    if (targetChannel) {
      let consumerCount = targetChannel.getOutputConsumerStatsList().length;
      targetChannel.killOutputConsumer(handler.channelOutputConsumerId);
      let consumerStats = targetChannel.getOutputConsumerStatsList();
      if (consumerCount <= 1) {
        targetChannel.unsubscribe();
        targetChannel.close();
      }
    }
  }

  async once(channel, handler) {
    let onceHandler = async () => {
      await handler();
      this.unsubscribe(channel, onceHandler);
    };
    this.subscribe(channel, onceHandler);
  }

  publish(channel, data) {
    this.exchange.transmitPublish(channel, data);
  }

  async invoke(action, data) {
    let {targetModuleName, targetCommand} = this._getCommandParts(action);
    if (!this._dependencyLookup[targetModuleName]) {
      let error = new Error(
        `Cannot invoke action ${
          action
        } on the ${
          targetModuleName
        } module because it is not listed as a dependency of the ${
          this.moduleName
        } module`
      );
      error.name = 'InvalidTargetModuleError';
      throw error;
    }
    return this.clients[targetModuleName].invoke(targetCommand, data);
  }

  _getCommandParts(command) {
    let targetModuleName;
    let targetCommand;
    if (command.indexOf(':') === -1) {
      targetModuleName = this.defaultTargetModuleName;
      targetCommand = command;
    } else {
      let parts = command.split(':');
      targetModuleName = parts[0];
      targetCommand = parts.slice(1).join(':');
    }
    if (this.redirects[targetModuleName] != null) {
      targetModuleName = this.redirects[targetModuleName];
    }
    return {targetModuleName, targetCommand};
  }
}

module.exports = Channel;
