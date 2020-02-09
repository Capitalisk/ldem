class FooModule {
  get alias() {
    return 'foo';
  }

  get dependencies() {
    return ['interchain', 'network'];
  }

  get events() {
    return [];
  }

  get actions() {
    return {};
  }

  async load(channel, options) {
    console.log('Loading foo module... Options:', options);
    await channel.invoke('interchain:updateModuleState', {
      foo: {}
    });
    let applicationState = await channel.invoke('interchain:getApplicationState', {});
    console.log('APPLICATION STATE:', applicationState);

    setInterval(async () => {
      let result = await channel.invoke('network:getPeers', {});
      let connectedPeers = result.filter(peerInfo => peerInfo.state === 2).map(peerInfo => peerInfo.ip);
      console.log('CONNECTED PEERS:', connectedPeers.length, connectedPeers);
    }, 1000);
  }

  async unload() {}
};

module.exports = FooModule;
