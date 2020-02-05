module.exports = {
  alias: 'one',

  dependencies: [],

  events: [],

  actions: {
    doSomething: {
      handler: (action) => action.params.number + 1,
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
