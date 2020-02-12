const Channel = require('./channel');
const http = require('http');
const objectAssignDeep = require('object-assign-deep');
const querystring = require('querystring');
const eetase = require('eetase');
eetase(process);

const socketClusterServer = require('socketcluster-server');
const fs = require('fs');
const argv = require('minimist')(process.argv.slice(2));

const MODULE_ALIAS = argv['ldem-module-alias'];
const MODULE_PATH = argv['ldem-module-path'];
const IPC_TIMEOUT = argv['ldem-ipc-timeout'];
const componentsConfig = JSON.parse(argv['ldem-components-config']);
const loggerConfig = componentsConfig.logger;

const DEFAULT_MODULE_ALIAS = 'chain';
const SOCKET_REPLACED_CODE = 4500;

const Logger = require(loggerConfig.loggerLibPath);

let logger = new Logger({
  ...loggerConfig,
  processStream: process,
  processType: 'worker',
  moduleAlias: MODULE_ALIAS
});

let TargetModuleClass = require(MODULE_PATH);
let targetModule = new TargetModuleClass({
  processStream: process,
  logger,
  alias: MODULE_ALIAS
});
let dependents = [];

let targetModuleDependencies = TargetModuleClass.dependencies || targetModule.dependencies;

function getUnixSocketPath(moduleAlias) {
  return `/tmp/ldex-${moduleAlias}.sock`;
}

let ipcPath = getUnixSocketPath(MODULE_ALIAS);
try {
  fs.unlinkSync(ipcPath);
} catch (error) {}

let httpServer = eetase(http.createServer());
let agServer = socketClusterServer.attach(httpServer);

(async () => {
  for await (let {error} of agServer.listener('error')) {
    logger.error(error);
  }
})();

let inboundModuleSockets = {};
let moduleActionNames = Object.keys(targetModule.actions);

async function handleRPC(actionName, request) {
  let moduleAction = targetModule.actions[actionName];
  let isActionPublic = moduleAction.isPublic;
  let moduleActionHandler = moduleAction.handler;

  if (request.data.isPublic && !isActionPublic) {
    let error = new Error(
      `The ${
        actionName
      } action of the ${
        MODULE_ALIAS
      } module is not public`
    );
    request.error(error);
    return;
  }
  let result;
  try {
    result = await moduleActionHandler({
      params: request.data.params
    });
  } catch (error) {
    logger.debug(error);
    let rpcError = new Error(
      `The ${actionName} action invoked on the ${
        MODULE_ALIAS
      } module failed because of the following error: ${error.message}`
    );
    rpcError.name = 'RPCError';
    request.error(rpcError);
    return;
  }
  request.end(result);
}

(async () => {
  for await (let {socket} of agServer.listener('connection')) {

    let query = socket.request.url.split('?')[1];
    let sourceModule = querystring.parse(query || '').source;
    socket.sourceModule = sourceModule;
    let existingModuleSocket = inboundModuleSockets[sourceModule];
    if (existingModuleSocket) {
      existingModuleSocket.disconnect(
        SOCKET_REPLACED_CODE,
        `Connection from module ${
          sourceModule
        } to module ${
          MODULE_ALIAS
        } was replaced by a newer connection`
      );
    }
    inboundModuleSockets[sourceModule] = socket;

    (async () => {
      for await (let {error} of socket.listener('error')) {
        logger.warn(error);
      }
    })();

    for (let actionName of moduleActionNames) {
      (async () => {
        for await (let request of socket.procedure(actionName)) {
          await handleRPC(actionName, request);
        }
      })();
    }
  }
})();

(async () => {
  for await (let {socket, code} of agServer.listener('disconnection')) {
    if (code !== SOCKET_REPLACED_CODE) {
      delete inboundModuleSockets[socket.sourceModule];
    }
  }
})();

httpServer.listen(ipcPath);

(async () => {
  try {
    await httpServer.listener('listening').once(IPC_TIMEOUT);
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }

  process.send({
    event: 'workerHandshake',
    dependencies: targetModuleDependencies
  });

  let result;
  try {
    result = await process.listener('message').once(IPC_TIMEOUT);
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }

  let [masterHandshake] = result;
  let {moduleConfig, appConfig, dependencies, dependents} = masterHandshake;

  let defaultModuleOptions = TargetModuleClass.defaults || targetModule.defaults || {};
  if (defaultModuleOptions.default != null) {
    defaultModuleOptions = defaultModuleOptions.default;
  }

  // For backwards compatibility with Lisk modules.
  targetModule.options = objectAssignDeep({}, defaultModuleOptions, moduleConfig);
  targetModule.appConfig = appConfig;

  let channel = new Channel({
    moduleAlias: MODULE_ALIAS,
    moduleActions: moduleActionNames,
    dependencies,
    dependents,
    redirects: appConfig.redirects,
    modulePathFunction: getUnixSocketPath,
    exchange: agServer.exchange,
    inboundModuleSockets,
    subscribeTimeout: IPC_TIMEOUT,
    allowPublishingWithoutAlias: targetModule.options.allowPublishingWithoutAlias,
    defaultTargetModuleAlias: targetModule.options.defaultTargetModuleAlias
  });

  (async () => {
    for await (let {error} of channel.listener('error')) {
      logger.error(error);
    }
  })();

  (async () => {
    for await (let {action, request} of channel.listener('rpc')) {
      await handleRPC(action, request);
    }
  })();

  try {
    await targetModule.load(channel, targetModule.options, targetModule.appConfig);
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }

  process.send({
    event: 'moduleReady'
  });
})();
