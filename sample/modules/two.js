module.exports = {
  alias: 'two',

  dependencies: [
    'one'
  ],

  events: [],

  actions: {
    doSomething: {
      handler: (action) => 222
    }
  },

  load: async (channel, options) => {
    console.log('Loading module two...');

    channel.subscribe('one:testEvent', async (data) => {
      console.log('Module two received event from module one:', data);
    });

    let result = await channel.invoke('one:doSomething', {number: 1});
    console.log('one:doSomething result:', result);
  },

  unload: async () => {}
};
