class AppModule {
  constructor() {
    this.channel = null;
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
        handler: async (action) => ({})
      },
      getApplicationState: {
        handler: async (action) => (...this.appState)
      },
      updateApplicationState: {
        handler: async (action) => {
          this.updateAppState(action.params);
        }
      }
    };
  }

  updateAppState(newAppState) {
    this.appState = {...newAppState};
    this.channel.publish('state:updated', this.appState);
  }

  async load(channel, options) {
    this.channel = channel;
  }

  async unload() {}
};

module.exports = AppModule;
