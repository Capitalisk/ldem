class OneModule {
  constructor({alias}) {
    this.alias = alias;
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
  }

  async unload() {}
};

module.exports = OneModule;
