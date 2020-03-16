class OneModule {
  constructor({alias, updates, updater}) {
    this.alias = alias;
    this.updates = updates;
    this.updater = updater;
    console.log(`Module ${this.alias} config updates:`, this.updates);
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
      if (this.updates.length && !this.updater.activeUpdate) {
        console.log(`Prepare to activate module ${this.alias} update: ${this.updates[0].id}`);
        this.updater.activateUpdate(this.updates[0]);
        this.updater.mergeActiveUpdate();
      }
    }, 4000);
  }

  async unload() {}
};

module.exports = OneModule;
