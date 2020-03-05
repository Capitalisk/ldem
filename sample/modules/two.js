class TwoModule {
  get alias() {
    return 'two';
  }

  get dependencies() {
    return ['one', 'other'];
  }

  get events() {
    return [];
  }

  get actions() {
    return {
      doSomething: {
        handler: (action) => 222
      },
      greeting: {
        handler: (action) => `Hello, this is module ${this.alias}`
      }
    };
  }

  async load(channel, options) {
    console.log('Loading module two...:');

    let handler = async (data) => {
      console.log('Module two received event from another module:', data);
    };
    channel.subscribe('one:testEvent', handler);
    channel.subscribe('other:testEvent', handler);

    let result = await channel.invoke('one:doSomething', {number: 1});
    console.log('one:doSomething result:', result);
  }

  async unload() {}
};

module.exports = TwoModule;
