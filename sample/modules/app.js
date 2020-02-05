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
      minVersion,
      protocolVersion,
      networkId,
      wsPort,
      httpPort
    } = this.appState;
    this.appState = {
      version,
      minVersion,
      protocolVersion,
      networkId,
      wsPort,
      httpPort,
      ...newAppState
		};
    this.channel.publish('state:updated', this.appState);
  }

  async load(channel, options) {
    this.channel = channel;
    this.options = options;
    this.appState = {
			version: options.version,
			minVersion: options.minVersion,
			protocolVersion: options.protocolVersion,
			networkId: options.networkId,
			wsPort: this.config.modules.network ? this.config.modules.network.wsPort : null,
			httpPort: this.config.modules.network ? this.config.modules.http_api.httpPort : null,
		};
  }

  async unload() {}
};

module.exports = AppModule;
