class OneModule {
  get alias() {
    return 'one';
  }

  get dependencies() {
    return [];
  }

  get events() {
    return [];
  }

  get actions() {
    return {
      doSomething: {
        handler: (action) => action.params.number + 1,
        isPublic: true // TODO 2: Implement
      }
    };
  }

  async load(channel, options) {
    console.log('Loading module one...');
    setInterval(() => {
      channel.publish('one:testEvent', 'This is module one');
    }, 1000);
  }

  async unload() {}
};

module.exports = OneModule;
