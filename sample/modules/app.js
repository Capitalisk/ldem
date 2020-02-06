class AppModule {
  constructor() {
    this.channel = null;
    this.options = {};
    this.appState = {};
  }

  get alias() {
    return 'app';
  }

  get dependencies() {
    return [];
  }

  get events() {
    return ['state:updated'];
  }

  get actions() {
    return {
      getComponentConfig: {
        handler: async (action) => {
          return this.options.components[action.params];
        }
      },
      getApplicationState: {
        handler: async (action) => ({...this.appState})
      },
      updateApplicationState: {
        handler: async (action) => {
          this.updateAppState(action.params);
        }
      }
    };
  }

  updateAppState(newAppState) {
    let {
      version,
      os,
      protocolVersion,
      nonce,
      height,
      state,
      broadhash,
      wsPort,
      httpPort
    } = this.appState;
    this.appState = {
      version,
      os,
      protocolVersion,
      nonce,
      height,
      state,
      broadhash,
      wsPort,
      httpPort,
      ...newAppState
    };
    this.channel.publish('state:updated', this.appState);
  }

  async load(channel, options) {
    this.channel = channel;
    this.options = options;
    let {mainHTTPAPIModule, mainNetworkModule} = options;
    this.appState = {
      ...options.nodeInfo,
      wsPort: this.config.modules[mainNetworkModule].wsPort,
      httpPort: this.config.modules[mainHTTPAPIModule].httpPort
    };
  }

  async unload() {}
};

module.exports = AppModule;
