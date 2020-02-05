const Channel = require('./channel');
const http = require('http');
const eetase = require('eetase');
eetase(process);

const socketClusterServer = require('socketcluster-server');
const fs = require('fs');
const Logger = require('./logger');
const argv = require('minimist')(process.argv.slice(2));

const MODULE_NAME = argv.n;
const MODULE_PATH = argv.p;

const HANDSHAKE_TIMEOUT = 2000;
const DEFAULT_MODULE_NAME = 'chain';

const SUBSCRIBE_TIMEOUT = 5000;

let logger = new Logger({
  process
});

let TargetModuleClass = require(MODULE_PATH);
let targetModule = new TargetModuleClass();
let dependents = [];

function getUnixSocketPath(targetModuleName) {
  return `/tmp/ldex-${targetModuleName}.sock`;
}

let ipcPath = getUnixSocketPath(MODULE_NAME);
try {
  fs.unlinkSync(ipcPath);
} catch (error) {}

let httpServer = http.createServer();
let agServer = socketClusterServer.attach(httpServer);

(async () => {
  for await (let {error} of agServer.listener('error')) {
    logger.error(error);
  }
})();

(async () => {
  for await (let {socket} of agServer.listener('connection')) {

    (async () => {
      for await (let {error} of socket.listener('error')) {
        logger.warn(error);
      }
    })();

    let moduleActionNames = Object.keys(targetModule.actions);
    for (let actionName of moduleActionNames) {
      let moduleActionHandler = targetModule.actions[actionName].handler;
      (async () => {
        for await (let request of socket.procedure(actionName)) {
          let result;
          try {
            result = await moduleActionHandler({
              params: request.data
            });
          } catch (error) {
            request.error(error);
            continue;
          }
          request.end(result);
        }
      })();
    }
  }
})();

httpServer.listen(ipcPath);

(async () => {
  process.send({
    event: 'workerHandshake',
    dependencies: targetModule.dependencies
  });

  let result;
  try {
    result = await process.listener('message').once(HANDSHAKE_TIMEOUT);
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }

  let [masterHandshake] = result;
  let {config, dependencies, dependents} = masterHandshake;

  let channel = new Channel({
    moduleName: MODULE_NAME,
    dependencies,
    dependents,
    modulePathFunction: getUnixSocketPath,
    exchange: agServer.exchange,
    subscribeTimeout: SUBSCRIBE_TIMEOUT,
    defaultTargetModuleName: DEFAULT_MODULE_NAME
  });

  (async () => {
    for await (let {error} of channel.listener('error')) {
      logger.error(error);
    }
  })();

  targetModule.options = config;
  targetModule.load(channel, config);
})();
