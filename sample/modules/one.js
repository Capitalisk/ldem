class OneModule {
  constructor({alias, configUpdates, updater}) {
    this.alias = alias;
    this.configUpdates = configUpdates;
    this.updater = updater;
    console.log(`Module ${this.alias} config updates:`, this.configUpdates);
  }

  get dependencies() {
    return ['app', 'network'];
  }

  get events() {
    return [];
  }

  get actions() {
    return {
      doSomething: {
        handler: (action) => action.params.number + 1,
        isPublic: true
      },
      greeting: {
        handler: (action) => `Hello, this is module ${this.alias}`
      }
    };
  }

  async load(channel, options) {
    channel.invoke('app:updateModuleState', {one: {hello: 123}});
    let result = await channel.invoke('app:getApplicationState');
    console.log('Application state:', result);

    console.log(`Loading module ${this.alias}...`);
    setInterval(() => {
      channel.publish(`${this.alias}:testEvent`, `This is module ${this.alias}`);
    }, 1000);

    setTimeout(() => {
      if (this.configUpdates.length) {
        console.log(`Prepare to apply module ${this.alias} update: ${this.configUpdates[0].id}`);
        this.updater.applyUpdates(this.configUpdates);
      }
    }, 4000);
  }

  async unload() {}
};

module.exports = OneModule;
