const socketClusterClient = require('socketcluster-client');
const AsyncStreamEmitter = require('async-stream-emitter');

class Channel extends AsyncStreamEmitter {
  constructor(options = {}) {
    super();

    let {
      moduleName,
      moduleActions,
      dependencies,
      dependents,
      redirects,
      modulePathFunction,
      exchange,
      inboundModuleSockets,
      subscribeTimeout,
      defaultTargetModuleName
    } = options;

    this.exchange = exchange;
    this.moduleName = moduleName;
    this.dependencies = dependencies || [];
    this.dependents = dependents;
    this.redirects = redirects;
    this.clients = {};
    this.inboundModuleSockets = inboundModuleSockets;
    this.subscribeTimeout = subscribeTimeout;
    this.moduleActions = moduleActions;
    this._dependencyLookup = {};

    for (let dependencyName of this.dependencies) {
      if (this.redirects[dependencyName] != null) {
        dependencyName = this.redirects[dependencyName];
      }
      this._dependencyLookup[dependencyName] = true;
      let client = socketClusterClient.create({
        protocolScheme: 'ws+unix',
        socketPath: modulePathFunction(dependencyName),
        query: {source: moduleName}
      });

      (async () => {
        for await (let {error} of client.listener('error')) {
          this.emit('error', {error});
        }
      })();

      for (let action of this.moduleActions) {
        (async () => {
          for await (let request of client.procedure(action)) {
            this.emit('rpc', {
              action,
              request
            });
          }
        })();
      }

      this.clients[dependencyName] = client;
    }
  }

  async subscribe(channel, handler) {
    let {targetModuleName, locator} = this._getLocatorParts(channel);
    let targetChannel = this._computeTargetChannel(targetModuleName, locator);
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
    let channelObject = this.clients[targetModuleName].subscribe(targetChannel);
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

    if (channelObject.state === channelObject.SUBSCRIBED) {
      return;
    }

    try {
      await channelObject.listener('subscribe').once(this.subscribeTimeout);
    } catch (err) {
      let error = new Error(
        `Subscription to the ${
          channel
        } channel of the ${
          targetModuleName
        } module by the ${
          this.moduleName
        } module timed out after ${
          this.subscribeTimeout
        } milliseconds`
      );
      error.name = 'SubscribeTimeOutError';
      throw error;
    }
  }

  unsubscribe(channel, handler) {
    let {targetModuleName, locator} = this._getLocatorParts(channel);
    let targetChannel = this._computeTargetChannel(targetModuleName, locator);
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
    let channelObject = targetClient.channel(targetChannel);
    if (channelObject) {
      channelObject.killOutputConsumer(handler.channelOutputConsumerId);
      let consumerCount = channelObject.getOutputConsumerStatsList().length;
      if (consumerCount <= 0) {
        channelObject.unsubscribe();
        channelObject.close();
      }
    }
  }

  async once(channel, handler) {
    let targetChannel = this._getTargetChannel(channel);
    let onceHandler = async () => {
      await handler();
      this.unsubscribe(targetChannel, onceHandler);
    };
    this.subscribe(targetChannel, onceHandler);
  }

  publish(channel, data) {
    let targetChannel = this._getTargetChannel(channel);
    this.exchange.transmitPublish(targetChannel, data);
  }

  async invoke(action, data) {
    let {targetModuleName, locator} = this._getLocatorParts(action);
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
    let invokePacket = {
      isPublic: false,
      params: data
    };
    let targetSocket = this.clients[targetModuleName];
    return targetSocket.invoke(locator, invokePacket);
  }

  async invokePublic(action, data) {
    let {targetModuleName, locator} = this._getLocatorParts(action);
    let targetSocket = this.clients[targetModuleName] || this.inboundModuleSockets[targetModuleName];
    if (!targetSocket) {
      let error = new Error(
        `Cannot invoke public action ${
          action
        } on the ${
          targetModuleName
        } module because it is not connected to the ${
          this.moduleName
        } module as either a dependent or dependency`
      );
      error.name = 'UnreachableTargetModuleError';
      throw error;
    }
    let invokePacket = {
      isPublic: true,
      params: data
    };
    return targetSocket.invoke(locator, invokePacket);
  }

  _getTargetChannel(channel) {
    let {targetModuleName, locator} = this._getLocatorParts(channel);
    return this._computeTargetChannel(targetModuleName, locator);
  }

  _computeTargetChannel(targetModuleName, locator) {
    return `${targetModuleName}:${locator}`;
  }

  _getLocatorParts(command) {
    let targetModuleName;
    let locator;
    if (command.indexOf(':') === -1) {
      targetModuleName = this.defaultTargetModuleName;
      locator = command;
    } else {
      let parts = command.split(':');
      targetModuleName = parts[0];
      locator = parts.slice(1).join(':');
    }
    if (this.redirects[targetModuleName] != null) {
      targetModuleName = this.redirects[targetModuleName];
    }
    return {targetModuleName, locator};
  }
}

module.exports = Channel;
