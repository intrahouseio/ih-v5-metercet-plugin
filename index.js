/**
 * index.js
 *   Точка входа плагина
 */

const util = require('util');

const app = require('./app');

(async () => {
  let plugin;
  try {
    const opt = getOptFromArgs();
    const pluginapi = opt && opt.pluginapi ? opt.pluginapi : 'ih-plugin-api';
    plugin = require(pluginapi + '/index.js')();
    plugin.log('Plugin has started.', 1);
    if (!opt.version) {
      plugin.exit(17, 'Для работы плагина требуется версия системы не ниже 5.17.25!');
    } else {
      plugin.params = await plugin.params.get();
      plugin.log('Received params...');
      plugin.log('Params:' + util.inspect(plugin.params), 1);
      await app(plugin);
    }
  } catch (err) {
    plugin.exit(8, 'ERROR: ' + util.inspect(err));
  }
})();

function getOptFromArgs() {
  let opt;
  try {
    opt = JSON.parse(process.argv[2]); //
  } catch (e) {
    opt = {};
  }
  return opt;
}
