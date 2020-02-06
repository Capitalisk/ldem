class FooModule {
  get alias() {
    return 'foo';
  }

  get dependencies() {
    return ['leasehold_net'];
  }

  get events() {
    return [];
  }

  get actions() {
    return {};
  }

  async load(channel, options) {
    console.log('Loading foo module... Options:', options);
    setInterval(async () => {
      let result = await channel.invoke('leasehold_net:getConnectedPeers', {});
      console.log('CONNECTED PEERS:', result.length, result.map(peerInfo => peerInfo.ipAddress));
    }, 1000);
  }

  async unload() {}
};

module.exports = FooModule;
