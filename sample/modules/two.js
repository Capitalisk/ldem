module.exports = {
  alias: 'two',

  dependencies: [
    'one'
  ],

  defaults: {},

  events: [],

  actions: [],

  load: async (channel, options) => {
    console.log('Loading module two...');
  },

  unload: async () => {}
};
