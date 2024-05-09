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
 *
 */
const util = require('util');

const Agent = require('./lib/agent');
const meters = require('./lib/meters');
// const meterlistformer = require('./lib/meterlistformer');

module.exports = async function(plugin) {
  let agent;
  try {
    meters.init(plugin);
    await getAndCreateMeterlist();
  } catch (err) {
    plugin.log('Для работы плагина требуется версия системы не ниже 5.17.25');
    plugin.exit(17);
  }

  try {
    agent = new Agent(plugin, plugin.params);
    agent.run();

    plugin.channels.onChange(async () => {
      await getAndCreateMeterlist();
      agent.restartPolling();
    });
  } catch (err) {
    plugin.log('ERROR: ' + util.inspect(err));
    plugin.exit(2);
  }


  async function getAndCreateMeterlist() {
    const devhard = await plugin.devhard.get();
    plugin.log('Received devhard data: ' + util.inspect(devhard), 2);
    meters.createMeterlist(devhard);
    if (meters.isEmpty()) {
      plugin.log('ERROR: Список счетчиков пуст! Нет каналов для опроса...');
      plugin.exit(3);
    }
  }

  process.on('SIGTERM', () => {
    process.exit(0);
  });
};
