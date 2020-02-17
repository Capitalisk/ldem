const fork = require('child_process').fork;
const path = require('path');
const eetase = require('eetase');
const objectAssignDeep = require('object-assign-deep');
const wait = require('./wait');

const CWD = process.cwd();
const PROJECT_MAIN_DIR_PATH = path.dirname(require.main.filename);
const WORKER_PATH = path.join(__dirname, 'worker.js');

const defaultConfig = require('./config/default.json');

class LDEM {
  constructor(options) {
    let {
      config
    } = options;

    defaultConfig.base.components.logger.loggerLibPath = path.resolve(
      __dirname,
      defaultConfig.base.components.logger.loggerLibPath
    );

    let appConfig = objectAssignDeep({}, defaultConfig, config);
    let rootDirPath = appConfig.base.rootDirPath || PROJECT_MAIN_DIR_PATH;
    let componentsConfig = appConfig.base.components;
    let loggerConfig = componentsConfig.logger;

    let rawModuleList = Object.keys(appConfig.modules);

    for (let moduleAlias of rawModuleList) {
      let plainModuleConfig = appConfig.modules[moduleAlias];

      let computeConfig = function (currentAlias, currentConfig, visitedAliases) {
        if (visitedAliases.has(currentAlias)) {
          throw new Error(
            `The module ${currentAlias} config had a cyclic dependency in its moduleBase`
          );
        }
        visitedAliases.add(currentAlias);
        if (currentConfig.moduleBase == null) {
          // Base case
          return objectAssignDeep({}, appConfig.base, currentConfig);
        }
        // Recursive case
        let baseModuleAlias = currentConfig.moduleBase;
        let baseConfig = appConfig.modules[baseModuleAlias];
        if (!baseConfig) {
          throw new Error(
            `The moduleBase option of the ${
              moduleAlias
            } module config was invalid - Could not find a module with the alias ${
              currentConfig.moduleBase
            }`
          );
        }
        let computedParentConfig = computeConfig(baseModuleAlias, baseConfig, visitedAliases);
        return objectAssignDeep({}, computedParentConfig, currentConfig);
      };

      appConfig.modules[moduleAlias] = computeConfig(moduleAlias, plainModuleConfig, new Set());

      let moduleConfig = appConfig.modules[moduleAlias];
      if (moduleConfig.modulePath != null) {
        moduleConfig.modulePath = path.resolve(rootDirPath, moduleConfig.modulePath);
      }
    }

    const Logger = require(loggerConfig.loggerLibPath);

    let logger = new Logger({
      ...loggerConfig,
      processStream: process,
      processType: 'master'
    });

    let moduleList = rawModuleList.filter(
      moduleAlias => (
        !!appConfig.modules[moduleAlias].modulePath &&
        appConfig.modules[moduleAlias].moduleEnabled
      )
    );
    let moduleSet = new Set(moduleList);
    let dependentMap = {};
    let moduleProcesses = {};

    (async () => {
      let launchingModulesPromises = [];

      for (let moduleAlias of moduleList) {
        let moduleConfig = objectAssignDeep({}, appConfig.base, appConfig.modules[moduleAlias]);
        let workerCWDPath = moduleConfig.workerCWDPath || CWD;

        let workerArgs = [
          '--ldem-module-alias',
          moduleAlias,
          '--ldem-ipc-timeout',
          moduleConfig.ipcTimeout
        ];
        let execOptions = {
          env: {...process.env},
          execArgv: process.execArgv,
          cwd: workerCWDPath
        };

        let launchModuleProcess = async (prevModuleProcess) => {
          if (prevModuleProcess) {
            logger.debug(`Relaunching process of ${moduleAlias} module...`);
          } else {
            logger.debug(`Launching process of ${moduleAlias} module...`);
          }

          let moduleProc = fork(WORKER_PATH, workerArgs, execOptions);
          eetase(moduleProc);
          moduleProc.moduleAlias = moduleAlias;
          moduleProc.moduleConfig = moduleConfig;

          (async () => {
            for await (let [error] of moduleProc.listener('error')) {
              logger.error(error);
            }
          })();

          (async () => {
            for await (let [code, signal] of moduleProc.listener('exit')) {
              moduleProc.killAllListeners();
              let signalMessage;
              if (signal) {
                signalMessage = ` and signal ${signal}`;
              } else {
                signalMessage = '';
              }
              logger.error(`Process ${moduleProc.pid} of ${moduleAlias} module exited with code ${code}${signalMessage}`);
              if (moduleProc.moduleConfig.respawnDelay) {
                logger.error(`Module ${moduleAlias} will be respawned in ${moduleProc.moduleConfig.respawnDelay} milliseconds...`);
                await wait(moduleProc.moduleConfig.respawnDelay);
              } else {
                logger.error(`Module ${moduleAlias} will be respawned immediately`);
              }
              launchModuleProcess(moduleProc);
            }
          })();

          moduleProc.send({
            event: 'masterInit',
            appConfig,
            moduleConfig
          });

          let workerHandshake;
          try {
            [workerHandshake] = await moduleProc.listener('message').once(moduleConfig.ipcTimeout);
          } catch (err) {
            let error = new Error(
              `The master process did not receive a workerHandshake packet from the ${
                moduleAlias
              } module before timeout of ${moduleConfig.ipcTimeout} milliseconds`
            );
            logger.fatal(error);
            process.exit(1);
          }
          if (!workerHandshake || workerHandshake.event !== 'workerHandshake') {
            let error = new Error(
              `The master process expected to receive a workerHandshake packet from the ${
                moduleAlias
              } module - Instead, it received: ${workerHandshake}`
            );
            logger.fatal(error);
            process.exit(1);
          }

          moduleProc.sendMasterHandshake = function(dependencies, dependents, appDependentMap) {
            moduleProc.send({
              event: 'masterHandshake',
              dependencies,
              dependents,
              appDependentMap
            });
          };
          moduleProc.sendAppReady = function() {
            moduleProc.send({
              event: 'appReady'
            });
          };

          if (prevModuleProcess) {
            moduleProc.dependencies = prevModuleProcess.dependencies;
            moduleProc.dependents = prevModuleProcess.dependents;
            moduleProc.targetDependencies = prevModuleProcess.targetDependencies;

            moduleProcesses[moduleAlias] = moduleProc;
            moduleProc.sendMasterHandshake(moduleProc.dependencies, moduleProc.dependents, dependentMap);
            // Listen for the 'moduleReady' event.
            let moduleReadyPacket;
            try {
              [moduleReadyPacket] = await moduleProc.listener('message').once(moduleConfig.ipcTimeout);
            } catch (error) {
              logger.error(
                `Did not receive a moduleReady event from ${
                  moduleAlias
                } module worker before timeout of ${
                  moduleConfig.ipcTimeout
                } milliseconds after respawn`
              );
              moduleProc.kill();

              return;
            }
            if (!moduleReadyPacket || moduleReadyPacket.event !== 'moduleReady') {
              let error = new Error(
                `The master process expected to receive a moduleReady packet from the respawned ${
                  moduleAlias
                } module - Instead, it received: ${moduleReadyPacket}`
              );
              logger.fatal(error);
              process.exit(1);
            }
            logger.debug(`Process ${moduleProc.pid} of module ${moduleAlias} is ready after respawn`);
            await wait(appConfig.base.appReadyDelay);
            moduleProc.sendAppReady();

            return;
          }

          // If module does not specify dependencies, assume it depends on all other modules.
          if (workerHandshake.dependencies == null) {
            // Use Set to guarantee uniqueness.
            moduleProc.dependencies = [...new Set(moduleList.filter(mod => mod !== moduleAlias))];
          } else {
            for (let dependencyName of workerHandshake.dependencies) {
              let targetDependencyName;
              if (appConfig.redirects[dependencyName] == null) {
                targetDependencyName = dependencyName;
              } else {
                targetDependencyName = appConfig.redirects[dependencyName];
              }
              if (!moduleSet.has(targetDependencyName)) {
                let error = new Error(
                  `Could not find the ${dependencyName} dependency target required by the ${moduleAlias} module`
                );
                logger.fatal(error);
                process.exit(1);
              }
            }
            // Use Set to guarantee uniqueness.
            moduleProc.dependencies = [...new Set(workerHandshake.dependencies)];
          }

          let targetDependencies = moduleProc.dependencies.map(
            dep => appConfig.redirects[dep] == null ? dep : appConfig.redirects[dep]
          );
          // This accounts for redirects.
          moduleProc.targetDependencies = [...new Set(targetDependencies)];

          for (let dep of moduleProc.targetDependencies) {
            if (!dependentMap[dep]) {
              dependentMap[dep] = [];
            }
            dependentMap[dep].push(moduleAlias);
          }
          moduleProcesses[moduleAlias] = moduleProc;
        };

        launchingModulesPromises.push(
          launchModuleProcess()
        );
      }

      await Promise.all(launchingModulesPromises);

      let moduleProcNames = Object.keys(moduleProcesses);
      let modulesWithoutDependencies = [];

      for (let moduleAlias of moduleProcNames) {
        let moduleProc = moduleProcesses[moduleAlias];
        moduleProc.dependents = dependentMap[moduleAlias] || [];
        if (!moduleProc.targetDependencies.length) {
          modulesWithoutDependencies.push(moduleAlias);
        }
      }

      let orderedProcNames = [];
      let currentLayer = [...modulesWithoutDependencies];
      let visitedModulesSet = new Set(currentLayer);

      while (currentLayer.length) {
        let nextLayerSet = new Set();
        for (let moduleAlias of currentLayer) {
          let moduleProc = moduleProcesses[moduleAlias];
          let isReady = moduleProc.targetDependencies.every(dep => visitedModulesSet.has(dep));
          if (isReady) {
            orderedProcNames.push(moduleAlias);
            visitedModulesSet.add(moduleAlias);
            nextLayerSet.delete(moduleAlias);
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

      for (let moduleAlias of moduleProcNames) {
        if (!visitedModulesSet.has(moduleAlias)) {
          unvisitedModuleSet.add(moduleAlias);
        }
      }

      if (unvisitedModuleSet.size) {
        logger.debug(
          `Identified circular dependencies: ${[...unvisitedModuleSet].join(', ')}`
        );
      }

      // Circular dependencies will be instantiated in any order.
      for (let unvisitedModuleAlias of unvisitedModuleSet) {
        orderedProcNames.push(unvisitedModuleAlias);
      }
      logger.debug(
        `Module loading order: ${orderedProcNames.join(', ')}`
      );

      for (let moduleAlias of orderedProcNames) {
        let moduleProc = moduleProcesses[moduleAlias];
        moduleProc.sendMasterHandshake(moduleProc.dependencies, moduleProc.dependents, dependentMap);
        let moduleReadyPacket;
        try {
          // Listen for the 'moduleReady' event.
          [moduleReadyPacket] = await moduleProc.listener('message').once(
            moduleProc.moduleConfig.ipcTimeout
          );
        } catch (err) {
          let error = new Error(
            `Did not receive a moduleReady event from the ${
              moduleAlias
            } module before timeout of ${
              moduleProc.moduleConfig.ipcTimeout
            } milliseconds`
          );
          logger.fatal(error);
          process.exit(1);
        }
        if (!moduleReadyPacket || moduleReadyPacket.event !== 'moduleReady') {
          let error = new Error(
            `The master process expected to receive a moduleReady packet from the ${
              moduleAlias
            } module - Instead, it received: ${moduleReadyPacket}`
          );
          logger.fatal(error);
          process.exit(1);
        }
        logger.debug(`Process ${moduleProc.pid} of module ${moduleProc.moduleAlias} is ready`);
      }

      await wait(appConfig.base.appReadyDelay);

      let result;
      for (let moduleAlias of orderedProcNames) {
        let moduleProc = moduleProcesses[moduleAlias];
        moduleProc.sendAppReady();
      }
    })();
  }
}

module.exports = LDEM;
