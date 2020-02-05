class TwoModule {
  get alias() {
    return 'two';
  }

  get dependencies() {
    return ['one'];
  }

  get events() {
    return [];
  }

  get actions() {
    return {
      doSomething: {
        handler: (action) => 222
      }
    };
  }

  async load(channel, options) {
    console.log('Loading module two...');

    channel.subscribe('one:testEvent', async (data) => {
      console.log('Module two received event from module one:', data);
    });

    let result = await channel.invoke('one:doSomething', {number: 1});
    console.log('one:doSomething result:', result);
  }

  async unload() {}
};

module.exports = TwoModule;
