const Channel = require('./channel');
const http = require('http');
const eetase = require('eetase');
eetase(process);

const socketClusterServer = require('socketcluster-server');
const fs = require('fs');
const Logger = require('./logger');
const argv = require('minimist')(process.argv.slice(2));

const moduleName = argv.n;
const modulePath = argv.p;
const HANDSHAKE_TIMEOUT = 2000;

let logger = new Logger();

let targetModule = require(modulePath);
let dependents = [];

function getUnixSocketPath(targetModuleName) {
  return `/tmp/ldex-${targetModuleName}.sock`;
}

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
  dependents = masterHandshake.dependents;

  let ipcPath = getUnixSocketPath(moduleName);
  try {
    fs.unlinkSync(ipcPath);
  } catch (error) {}

  let httpServer = http.createServer();
  let agServer = socketClusterServer.attach(httpServer);

  let channel = new Channel({
    dependencies: targetModule.dependencies,
    dependents,
    modulePathFunction: getUnixSocketPath
  });

  (async () => {
    for await (let {error} of channel.listener('error')) {
      logger.error(error);
    }
  })();

  targetModule.load(channel);

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

      (async () => {
        for await (let data of socket.receiver('event')) {

        }
      })();

      (async () => {
        for await (let request of socket.procedure('action')) {

        }
      })();
    }
  })();

  console.log('LISTEN TODO 22', ipcPath)

  httpServer.listen(ipcPath);

})();
