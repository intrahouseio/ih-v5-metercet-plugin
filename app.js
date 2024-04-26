/**
 * app.js
 *
 *   Основной модуль плагина
 *   - запрашивает и формирует каналы
 *   - запускает агента для опроса счетчиков
 *   - слушает событие изменения каналов. Это могут быть:
 *        - добавление-удаление узлов (счетчиков)
 *        - изменение парметров каналов (r:1/0, polltimefctr: - изменение интервала опроса)
 *   - по событию изменения
 *       - запрашивает и формирует каналы заново
 *       - вызывает функцию агента restartPolling() с новым списком счетчиков
 *
 */
const util = require('util');

const Agent = require('./lib/agent');
const meterlistformer = require('./lib/meterlistformer');

module.exports = async function(plugin) {
  let agent;
  let meterlist = [];

  try {
    meterlist = await meterlistformer(plugin);

    agent = new Agent(plugin, plugin.params);
    agent.run(meterlist);

    plugin.channels.onChange(async () => {
      meterlist = await meterlistformer(plugin);
      agent.restartPolling(meterlist);
    });
  } catch (err) {
    plugin.log('ERROR: ' + util.inspect(err));
    plugin.exit(2);
  }

  process.on('SIGTERM', () => {
    process.exit(0);
  });
};
