const socketClusterClient = require('socketcluster-client');
const AsyncStreamEmitter = require('async-stream-emitter');

class Channel extends AsyncStreamEmitter {
  constructor(options = {}) {
    super();

    let {
      moduleAlias,
      moduleActions,
      dependencies,
      dependents,
      redirects,
      modulePathFunction,
      exchange,
      inboundModuleSockets,
      subscribeTimeout,
      allowPublishingWithoutAlias,
      defaultTargetModuleAlias
    } = options;

    this.exchange = exchange;
    this.moduleAlias = moduleAlias;
    this.dependencies = dependencies || [];
    this.dependents = dependents;
    this.redirects = redirects;
    this.clients = {};
    this.inboundModuleSockets = inboundModuleSockets;
    this.subscribeTimeout = subscribeTimeout;
    this.moduleActions = moduleActions;
    this.allowPublishingWithoutAlias = allowPublishingWithoutAlias;
    this.defaultTargetModuleAlias = defaultTargetModuleAlias;
    this._dependencyLookup = {};

    for (let dependencyName of this.dependencies) {
      if (this.redirects[dependencyName] != null) {
        dependencyName = this.redirects[dependencyName];
      }
      this._dependencyLookup[dependencyName] = true;
      let client = socketClusterClient.create({
        protocolScheme: 'ws+unix',
        socketPath: modulePathFunction(dependencyName),
        query: {source: moduleAlias}
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
    let {targetModuleAlias, locator} = this._getLocatorInfo(channel);
    let targetChannel = this._computeTargetChannel(targetModuleAlias, locator);
    if (!this._dependencyLookup[targetModuleAlias]) {
      let error = new Error(
        `Cannot subscribe to the ${
          channel
        } channel on the ${
          targetModuleAlias
        } module because it is not listed as a dependency of the ${
          this.moduleAlias
        } module`
      );
      error.name = 'InvalidTargetModuleError';
      throw error;
    }
    let channelObject = this.clients[targetModuleAlias].subscribe(targetChannel);
    let channelDataConsumer = channelObject.createConsumer();
    if (!handler.channelOutputConsumerIds) {
      handler.channelOutputConsumerIds = new Map();
    }
    if (!handler.channelOutputConsumerIds.has(targetChannel)) {
      handler.channelOutputConsumerIds.set(targetChannel, []);
    }
    handler.channelOutputConsumerIds.get(targetChannel).push(channelDataConsumer.id);

    (async () => {
      for await (let event of channelDataConsumer) {
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
          targetModuleAlias
        } module by the ${
          this.moduleAlias
        } module timed out after ${
          this.subscribeTimeout
        } milliseconds`
      );
      error.name = 'SubscribeTimeOutError';
      throw error;
    }
  }

  unsubscribe(channel, handler) {
    let {targetModuleAlias, locator} = this._getLocatorInfo(channel);
    let targetChannel = this._computeTargetChannel(targetModuleAlias, locator);
    if (!this._dependencyLookup[targetModuleAlias]) {
      let error = new Error(
        `Cannot unsubscribe from the ${
          channel
        } channel on the ${
          targetModuleAlias
        } module because it is not listed as a dependency of the ${
          this.moduleAlias
        } module`
      );
      error.name = 'InvalidTargetModuleError';
      throw error;
    }
    let targetClient = this.clients[targetModuleAlias];
    let channelObject = targetClient.channel(targetChannel);
    if (channelObject) {
      if (handler.channelOutputConsumerIds && handler.channelOutputConsumerIds.has(targetChannel)) {
        let channelConsumerIds = handler.channelOutputConsumerIds.get(targetChannel);
        for (let consumerId of channelConsumerIds) {
          channelObject.killOutputConsumer(consumerId);
        }
        handler.channelOutputConsumerIds.delete(targetChannel);
        if (handler.channelOutputConsumerIds.size <= 0) {
          delete handler.channelOutputConsumerIds;
        }
      }
      let consumerCount = channelObject.getOutputConsumerStatsList().length;
      if (consumerCount <= 0) {
        channelObject.unsubscribe();
        channelObject.close();
      }
    }
  }

  async once(channel, handler) {
    let locatorInfo = this._getLocatorInfo(channel);
    let targetChannel = this._getTargetChannel(locatorInfo);
    let onceHandler = async (event) => {
      await handler(event);
      this.unsubscribe(targetChannel, onceHandler);
    };
    this.subscribe(targetChannel, onceHandler);
  }

  publish(channel, data) {
    let locatorInfo = this._getLocatorInfo(channel);
    if (!this.allowPublishingWithoutAlias && !locatorInfo.hasAlias) {
      throw new Error(
        `Publishing to a channel without specifying a module alias is not allowed - The ${
          channel
        } channel name must be preceded by the ${
          this.moduleAlias
        } module alias in the format ${this.moduleAlias}:eventName`
      );
    }
    if (locatorInfo.targetModuleAlias !== this.moduleAlias) {
      throw new Error(
        `The module alias prefix of the ${
          channel
        } channel must refer to the publisher which is the ${
          this.moduleAlias
        } module`
      );
    }
    let targetChannel = this._getTargetChannel(locatorInfo);
    this.exchange.transmitPublish(targetChannel, data);
  }

  async invoke(action, data) {
    let {targetModuleAlias, locator} = this._getLocatorInfo(action);
    if (!this._dependencyLookup[targetModuleAlias]) {
      let error = new Error(
        `Cannot invoke action ${
          action
        } on the ${
          targetModuleAlias
        } module because it is not listed as a dependency of the ${
          this.moduleAlias
        } module`
      );
      error.name = 'InvalidTargetModuleError';
      throw error;
    }
    let invokePacket = {
      isPublic: false,
      params: data
    };
    let targetSocket = this.clients[targetModuleAlias];
    return targetSocket.invoke(locator, invokePacket);
  }

  async invokePublic(action, data) {
    let {targetModuleAlias, locator} = this._getLocatorInfo(action);
    let targetSocket = this.clients[targetModuleAlias] || this.inboundModuleSockets[targetModuleAlias];
    if (!targetSocket) {
      let error = new Error(
        `Cannot invoke public action ${
          action
        } on the ${
          targetModuleAlias
        } module because it is not connected to the ${
          this.moduleAlias
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

  _getTargetChannel({targetModuleAlias, locator}) {
    return this._computeTargetChannel(targetModuleAlias, locator);
  }

  _computeTargetChannel(targetModuleAlias, locator) {
    return `${targetModuleAlias}:${locator}`;
  }

  _getLocatorInfo(command) {
    let targetModuleAlias;
    let locator;
    let hasAlias;
    if (command.indexOf(':') === -1) {
      targetModuleAlias = this.defaultTargetModuleAlias;
      locator = command;
      hasAlias = false;
    } else {
      let parts = command.split(':');
      targetModuleAlias = parts[0];
      locator = parts.slice(1).join(':');
      hasAlias = true;
    }
    if (this.redirects[targetModuleAlias] != null) {
      targetModuleAlias = this.redirects[targetModuleAlias];
    }
    return {targetModuleAlias, locator, hasAlias};
  }
}

module.exports = Channel;
