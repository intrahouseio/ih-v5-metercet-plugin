/**
 * meterlistformer.js
 *   Модуль запрашивает с сервера данные и формирует каналы (список счетчиков meterlist)
 *    элемент массива meterlist содержит параметры узла и каналы: {meterid, longadr, assets:{ks:...}, chans:{}}
 *
 *   - Выполняет запрос devhard на сервер  - все каналы, включая папки (запрос channels вернет только каналы для чтения)
 *   - Для каждого счетчика (узла) проверяет - если пустой, создает новые каналы
 *   - Новые каналы отправляет на сервер - upsertChannnels
 *   - Добавляет счетчик в meterlist
 *
 *
 * @return {Array of Objects} - meterlist
 */

const util = require('util');

const channelutils = require('./channelutils');

module.exports = async function(plugin) {
  const devhard = await plugin.devhard.get();
  plugin.log('Received devhard data: ' + util.inspect(devhard), 2);

  // Собрать узлы
  const meterMap = {};
  devhard.forEach(item => {
    if (item.foldertype == 'node') {
      if (!item.longadr) {
        plugin.log(item.chan + ': отсутствует серийный номер счетчика. Не включается в список!');
      } else {
        meterMap[item._id] = { node: item, chans: {} };
      }
    }
  });

  // Собрать каналы узлов
  devhard.forEach(item => {
    if (!item.folder) {
      if (!meterMap[item.parent]) {
        plugin.log('В списке счетчиков отсутствует узел для канала: ' + util.inspect(item) + '. Пропускается..');
      } else {
        const {_id, chan, r, polltimefctr } = item;
        meterMap[item.parent].chans[item.chan] = {id:_id, chan,r, countdown:0, polltimefctr};
        // meterMap[item.parent].chans.push(item);
      }
    }
  });

  // Формировать каналы для пустых узлов
  let newChannels = [];
  Object.keys(meterMap).forEach(key => {
    if (!meterMap[key].chans.length) {
      const arr = channelutils.formOneMeterChannels(meterMap[key].node);
      meterMap[key].chans = arr;
      newChannels = [...newChannels, ...arr];
    }
  });

  // Сформировать массив meterlist
  const meterlist = Object.keys(meterMap).map(key => {
    const { longadr, chan} = meterMap[key].node;
    // TODO - chans получше организовать?
    const chans = meterMap[key].chans;
    const assets = channelutils.formAssets(meterMap[key].node);
    return { longadr, parentname: chan, assets, chans };
  });

  // Передать новые каналы на сервер
  if (newChannels.length) {
    plugin.log('Send upsertChannels ' + util.inspect(newChannels));
    plugin.send({ type: 'upsertChannels', data: newChannels });
  }
  plugin.log('meterlist ' + util.inspect(meterlist));
  return meterlist;
};

// Структура элемента массива meterlist
//  { longadr, parentname, assets, chans };
// chans = {I1:{id, r:1, pollmeterfctr:10, chan:'I1', countdown:8}}
