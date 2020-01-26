module.exports = {
  alias: 'one',

  dependencies: [],

  events: [],

  actions: {
    doSomething: {
      handler: (action) => 111,
      isPublic: true
    }
  },

  load: async (channel, options) => {
    console.log('Loading module one...');
    setInterval(() => {
      channel.publish('one:testEvent', 'This is module one');
    }, 1000);
  },

  unload: async () => {}
};
