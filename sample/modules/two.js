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
    console.log('Loading module two...:');

    let handler = async (data) => {
      console.log('Module two received event from module one:', data);
    };
    channel.subscribe('one:testEvent', handler);

    let result = await channel.invoke('one:doSomething', {number: 1});
    console.log('one:doSomething result:', result);
  }

  async unload() {}
};

module.exports = TwoModule;
