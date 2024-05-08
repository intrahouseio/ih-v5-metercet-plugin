/**
 * meterlistformer.js
 *   Модуль запрашивает с сервера данные и формирует каналы (список счетчиков meterlist)
 *    элемент массива meterlist содержит параметры узла и каналы: {longadr, assets:{ks:...}, chans:{}}
 *
 *   - Выполняет запрос devhard на сервер  - все каналы, включая папки (запрос channels вернет только каналы для чтения)
 *   - Объединяет каналы в узлы и формирует список счетчиков meterlist
 *
 * @return {Array of Objects} - meterlist
 */

const util = require('util');

const protocol = require('./protocol');

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
        meterMap[item._id] = { node: item, chans: [] };
      }
    }
  });

  // Собрать каналы узлов
  devhard.forEach(item => {
    if (!item.folder) {
      if (!meterMap[item.parent]) {
        plugin.log('В списке счетчиков отсутствует узел для канала: ' + util.inspect(item) + '. Пропускается..');
      } else {
        meterMap[item.parent].chans.push(item);
      }
    }
  });

  // Сформировать массив meterlist
  const meterlist = Object.keys(meterMap).map(key => {
    const { longadr, chan } = meterMap[key].node;
    const chans = formChanObj(meterMap[key].chans);
    const assets = protocol.formAssets(meterMap[key].node);
    return { longadr, parentname: chan, assets, chans };
  });
  return meterlist;
};

// Структура элемента массива meterlist
//  { longadr, parentname, assets, chans };
// chans = {I1:{id:'lYgBDoH6vg1',  chan:'I1', r:1, pollmeterfctr:10, countdown:8}}

function formChanObj(chanArr) {
  const res = {};
  chanArr.forEach(item => {
    const { _id, chan, r, pollmeterfctr = 1 } = item;
    res[chan] = { id: _id, chan, r, pollmeterfctr, countdown: 0 };
  });
  return res;
}
