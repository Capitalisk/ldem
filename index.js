const fork = require('child_process').fork;
const path = require('path');
const eetase = require('eetase');
const Logger = require('./logger');
const objectAssignDeep = require('object-assign-deep');
const wait = require('./wait');
const argv = require('minimist')(process.argv.slice(2));

const CWD = process.cwd();
const DEFAULT_IPC_TIMEOUT = 10000;
const WORKER_PATH = path.join(__dirname, 'worker.js');
const CONFIG_PATH = path.join(CWD, argv.c);

const defaultConfig = require('./config/default.json');
const appConfig = require(CONFIG_PATH);

Object.values(defaultConfig.modules).forEach((moduleConfig) => {
  if (moduleConfig.modulePath != null) {
    moduleConfig.modulePath = path.join(__dirname, moduleConfig.modulePath);
  }
});

Object.values(appConfig.modules).forEach((moduleConfig) => {
  if (moduleConfig.modulePath != null) {
    moduleConfig.modulePath = path.join(CWD, moduleConfig.modulePath);
  }
});

let config = objectAssignDeep({}, defaultConfig, appConfig);

let ipcTimeout = config.base.ipcTimeout == null ? DEFAULT_IPC_TIMEOUT : config.base.ipcTimeout;

let logger = new Logger({
  processStream: process,
  processType: 'master',
  logLevel: config.base.logLevel || 'debug'
});

let moduleList = Object.keys(config.modules).filter(moduleName => !!config.modules[moduleName].modulePath);
let moduleSet = new Set(moduleList);
let dependentMap = {};
let moduleProcesses = {};

(async () => {
  for (let moduleName of moduleList) {
    let moduleConfig = objectAssignDeep({}, config.base, config.modules[moduleName]);
    let execOptions = {
      env: {...process.env},
      execArgv: process.execArgv,
      cwd: CWD
    };
    let workerArgs = [
      '-n',
      moduleName,
      `-p`,
      moduleConfig.modulePath,
      '-l',
      moduleConfig.logLevel || 'debug',
      '-t',
      ipcTimeout
    ];
    let launchModuleProcess = async (prevModuleProcess) => {
      if (prevModuleProcess) {
        logger.debug(`Relaunching process of ${moduleName} module...`);
      } else {
        logger.debug(`Launching process of ${moduleName} module...`);
      }
      let moduleProc = fork(WORKER_PATH, process.argv.slice(2).concat(workerArgs), execOptions);
      eetase(moduleProc);
      moduleProc.moduleName = moduleName;
      moduleProc.moduleConfig = moduleConfig;

      (async () => {
        for await (let [error] of moduleProc.listener('error')) {
          logger.error(error);
        }
      })();

      (async () => {
        for await (let [code, signal] of moduleProc.listener('exit')) {
          let signalMessage;
          if (signal) {
            signalMessage = ` and signal ${signal}`;
          } else {
            signalMessage = '';
          }
          logger.error(`Process ${moduleProc.pid} of ${moduleName} module exited with code ${code}${signalMessage}`);
          if (moduleProc.moduleConfig.respawnDelay) {
            logger.error(`Module ${moduleName} will be respawned in ${moduleProc.moduleConfig.respawnDelay} milliseconds...`);
            await wait(moduleProc.moduleConfig.respawnDelay);
          } else {
            logger.error(`Module ${moduleName} will be respawned immediately`);
          }
          launchModuleProcess(moduleProc);
        }
      })();

      let result;
      try {
        result = await moduleProc.listener('message').once(ipcTimeout);
      } catch (error) {
        logger.fatal(error);
        process.exit(1);
      }
      let [workerHandshake] = result;

      moduleProc.sendMasterHandshake = function() {
        this.send({
          event: 'masterHandshake',
          appConfig: config,
          moduleConfig: this.moduleConfig,
          dependencies: this.dependencies,
          dependents: this.dependents
        });
      };
      moduleProc.sendAppReady = function() {
        this.send({
          event: 'appReady'
        });
      };

      if (prevModuleProcess) {
        moduleProc.dependents = prevModuleProcess.dependents;
        moduleProc.dependencies = prevModuleProcess.dependencies;
        moduleProc.targetDependencies = prevModuleProcess.targetDependencies;

        moduleProcesses[moduleName] = moduleProc;
        moduleProc.sendMasterHandshake();
        // Listen for the 'moduleReady' event.
        try {
          await moduleProc.listener('message').once(ipcTimeout);
        } catch (error) {
          logger.error(
            `Did not receive moduleReady event from worker of ${moduleName} module after relaunch`
          );
          moduleProc.kill();
          return;
        }
        logger.debug(`Process ${moduleProc.pid} of module ${moduleName} is ready after respawn`);
        moduleProc.sendAppReady();
        return;
      }

      // If module does not specify dependencies, assume it depends on all other modules.
      if (workerHandshake.dependencies == null) {
        // Use Set to guarantee uniqueness.
        moduleProc.dependencies = [...new Set(moduleList.filter(mod => mod !== moduleName))];
      } else {
        for (let dependencyName of workerHandshake.dependencies) {
          let targetDependencyName;
          if (config.redirects[dependencyName] == null) {
            targetDependencyName = dependencyName;
          } else {
            targetDependencyName = config.redirects[dependencyName];
          }
          if (!moduleSet.has(targetDependencyName)) {
            let error = new Error(
              `Could not find the ${dependencyName} dependency target required by the ${moduleName} module`
            );
            logger.fatal(error);
            process.exit(1);
          }
        }
        // Use Set to guarantee uniqueness.
        moduleProc.dependencies = [...new Set(workerHandshake.dependencies)];
      }

      let targetDependencies = moduleProc.dependencies.map(
        dep => config.redirects[dep] == null ? dep : config.redirects[dep]
      );
      // This accounts for redirects.
      moduleProc.targetDependencies = [...new Set(targetDependencies)];

      for (let dep of moduleProc.targetDependencies) {
        if (!dependentMap[dep]) {
          dependentMap[dep] = [];
        }
        dependentMap[dep].push(moduleName);
      }
      moduleProcesses[moduleName] = moduleProc;
    };

    await launchModuleProcess();
  }

  let moduleProcNames = Object.keys(moduleProcesses);
  let modulesWithoutDependencies = [];

  for (let moduleName of moduleProcNames) {
    let moduleProc = moduleProcesses[moduleName];
    moduleProc.dependents = dependentMap[moduleName] || [];
    if (!moduleProc.targetDependencies.length) {
      modulesWithoutDependencies.push(moduleName);
    }
  }

  let orderedProcNames = [];
  let currentLayer = [...modulesWithoutDependencies];
  let visitedModulesSet = new Set(currentLayer);

  while (currentLayer.length) {
    let nextLayerSet = new Set();
    for (let moduleName of currentLayer) {
      let moduleProc = moduleProcesses[moduleName];
      let isReady = moduleProc.targetDependencies.every(dep => visitedModulesSet.has(dep));
      if (isReady) {
        orderedProcNames.push(moduleName);
        visitedModulesSet.add(moduleName);
        nextLayerSet.delete(moduleName);
        for (let dependent of moduleProc.dependents) {
          if (!visitedModulesSet.has(dependent)) {
            nextLayerSet.add(dependent);
          }
        }
      }
    }
    currentLayer = [...nextLayerSet];
  }

  let unvisitedModuleSet = new Set();

  for (let moduleName of moduleProcNames) {
    if (!visitedModulesSet.has(moduleName)) {
      unvisitedModuleSet.add(moduleName);
    }
  }

  if (unvisitedModuleSet.size) {
    logger.debug(
      `Identified circular dependencies: ${[...unvisitedModuleSet].join(', ')}`
    );
  }

  // Circular dependencies will be instantiated in any order.
  for (let unvisitedModuleName of unvisitedModuleSet) {
    orderedProcNames.push(unvisitedModuleName);
  }
  logger.debug(
    `Module loading order: ${orderedProcNames.join(', ')}`
  );

  for (let moduleName of orderedProcNames) {
    let moduleProc = moduleProcesses[moduleName];
    moduleProc.sendMasterHandshake();
  }

  let result;
  try {
    // Listen for the 'moduleReady' event.
    let moduleProcessList = Object.values(moduleProcesses);
    await Promise.all(
      moduleProcessList.map(async (moduleProc) => {
        return moduleProc.listener('message').once(ipcTimeout);
      })
    );
    moduleProcessList.forEach((moduleProc) => {
      logger.debug(`Process ${moduleProc.pid} of module ${moduleProc.moduleName} is ready`);
    });
    for (let moduleName of orderedProcNames) {
      let moduleProc = moduleProcesses[moduleName];
      moduleProc.sendAppReady();
    }
  } catch (error) {
    logger.fatal(error);
    process.exit(1);
  }

})();
