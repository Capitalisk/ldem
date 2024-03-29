const Channel = require('./channel');
const http = require('http');
const objectAssignDeep = require('object-assign-deep');
const querystring = require('querystring');
const path = require('path');

const eetase = require('eetase');
eetase(process);

const socketClusterServer = require('socketcluster-server');
const fs = require('fs');
const Updater = require('./updater');
const argv = require('minimist')(process.argv.slice(2));

const DEFAULT_MODULE_ALIAS = 'chain';
const SOCKET_REPLACED_CODE = 4500;

const MODULE_ALIAS = argv['ldem-module-alias'];
let ipcTimeout = argv['ldem-ipc-timeout'];
let ackTimeout = argv['ldem-ack-timeout'];

(async () => {
  await process.listener('disconnect').once();
  process.exit();
})();

(async () => {
  let masterInitResult;
  try {
    masterInitResult = await process.listener('message').once(ipcTimeout);
  } catch (error) {
    process.exit(1);
  }
  let [{appConfig, moduleConfig, moduleUpdates, moduleActiveUpdate}] = masterInitResult;

  // Update ipcTimeout and ackTimeout using the config option at the module scope
  ipcTimeout = moduleConfig.ipcTimeout;
  ackTimeout = moduleConfig.ackTimeout;
  let componentsConfig = moduleConfig.components;
  let loggerConfig = componentsConfig.logger;

  let Logger = require(loggerConfig.loggerLibPath);

  let logger = new Logger({
    ...loggerConfig,
    processStream: process,
    processType: 'worker',
    processAlias: MODULE_ALIAS
  });

  let updater = new Updater({
    processStream: process,
    updates: moduleUpdates,
    activeUpdate: moduleActiveUpdate
  });

  let TargetModuleClass = require(path.resolve(process.cwd(), moduleConfig.modulePath));

  let defaultModuleConfig = TargetModuleClass.defaults || {};
  if (defaultModuleConfig.default != null) {
    defaultModuleConfig = defaultModuleConfig.default;
  }

  // For backwards compatibility with Lisk modules.
  let targetModuleConfig = objectAssignDeep({}, defaultModuleConfig, moduleConfig);
  let targetModuleAppConfig = appConfig;

  let targetModule;

  try {
    targetModule = new TargetModuleClass({
      processStream: process,
      logger,
      alias: MODULE_ALIAS,
      config: targetModuleConfig,
      appConfig: targetModuleAppConfig,
      updates: moduleUpdates,
      updater
    });
  } catch (error) {
    logger.fatal(error);
    process.exit(1);
  }

  // For backward compatibility.
  targetModule.options = targetModuleConfig;
  targetModule.appConfig = targetModuleAppConfig;
  let moduleRedirects = targetModuleConfig.moduleRedirects;
  let unixSocketPrefix = targetModuleConfig.unixSocketNamePrefix || 'ldem';

  let targetModuleDependencies = TargetModuleClass.dependencies || targetModule.dependencies;

  function getUnixSocketPath(moduleAlias) {
    return `/tmp/${unixSocketPrefix}_${moduleAlias}.sock`;
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
    let requestData = request.data || {};

    if (requestData.isPublic && !isActionPublic) {
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
        isPublic: !!requestData.isPublic,
        params: requestData.params
      });
    } catch (error) {
      logger.debug(error);
      let rpcError = new Error(
        `The ${actionName} action invoked on the ${
          MODULE_ALIAS
        } module failed because of the following error: ${error.message}`
      );
      rpcError.name = 'RPCError';
      rpcError.sourceError = {
        ...error,
        message: error.message,
        stack: requestData.isPublic ? undefined : error.stack
      };
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

      (async () => {
        for await (let request of socket.procedure('ping')) {
          let requestData = request.data || {};
          if (requestData.isWorkerAction) {
            request.end();
          }
        }
      })();
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

  try {
    await httpServer.listener('listening').once(ipcTimeout);
  } catch (err) {
    let error = new Error(
      `IPC server on module ${MODULE_ALIAS} failed to listen before timeout of ${ipcTimeout} milliseconds`
    );
    logger.fatal(error);
    process.exit(1);
  }

  process.send({
    event: 'workerHandshake',
    dependencies: targetModuleDependencies
  });

  let result;
  try {
    result = await process.listener('message').once(ipcTimeout);
  } catch (err) {
    let error = new Error(
      `The ${MODULE_ALIAS} module did not receive a masterHandshake event before timeout of ${ipcTimeout} milliseconds`
    );
    logger.fatal(error);
    process.exit(1);
  }

  let [masterHandshake] = result;
  let {dependencies, dependents, appDependentMap} = masterHandshake;

  let channel = new Channel({
    moduleAlias: MODULE_ALIAS,
    moduleActions: moduleActionNames,
    moduleRedirects,
    dependencies,
    dependents,
    modulePathFunction: getUnixSocketPath,
    exchange: agServer.exchange,
    inboundModuleSockets,
    connectTimeout: ipcTimeout,
    subscribeTimeout: ipcTimeout,
    ackTimeout,
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
    await targetModule.load(channel, targetModule.options, targetModule.appConfig, appDependentMap);
  } catch (error) {
    logger.fatal(error);
    process.exit(1);
  }

  process.send({
    event: 'moduleReady'
  });
})();
