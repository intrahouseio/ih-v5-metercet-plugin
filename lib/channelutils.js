/**
 * НЕ ИСПОЛЬЗУЕТСЯ
 */

// const util = require('util');
const shortid = require('shortid');

exports.formOneMeterChannels = formOneMeterChannels;
exports.getAllMetering = getAllMetering;
// exports.formAssets = formAssets;

const allMetering = [
  { mid: 'E', period: 1 },
  { mid: 'P', period: 1 },
  { mid: 'Q', period: 1 },
  { mid: 'S', period: 1 },
  { mid: 'I', period: 1 },
  { mid: 'U', period: 1 },
  { mid: 'F', period: 1 }
];

function getAllMetering() {
  return allMetering;
}

// Сформировать assets для счетчика - берутся параметры узла
// Перенесено в protocol
/*
function formAssets(item) {
  const assets = {
    kti: item.handkti || 1, // Коэф по току
    ktu: item.handktu || 1, // Коэф по напряжению
    ks: item.ks || 1, // Коэф Кс для мгновенных мощностей, зависит от Inom, Unom
    constant: item.constant || 1250, // Постоянная счетчика
    password: item.password || ''
  };

  // Посчитать коэффициент для энергии = kti*ktu/2*const
  assets.kt = (assets.kti * assets.ktu) / (2 * assets.constant);
  return assets;
}
*/

function formOneMeterChannels(item) {
  const res = [];
  const ntariffs = 1;
  let order = 10;
  allMetering.forEach(am => {
    let vals;
    switch (am.mid) {
      case 'E':
        vals = energyChannels(ntariffs, '');
        break;
      case 'ES':
        vals = energyChannels(ntariffs, 'S');
        break;
      case 'EX':
        vals = energyChannels(ntariffs, 'X');
        break;
      default:
        vals = meteringChannels(am.mid);
    }
    if (vals) {
      vals.forEach(vitem => {
        vitem.id = shortid.generate();
        vitem.devpropname = vitem.chan; // U1
        // vitem.id = item.unitid + '_' + vitem.id; // 1_U1
        vitem.parent = item._id;
        vitem.order = order;
        order += 10;
      });
      res.push(...vals);
    }
  });
  return res;
}

function energyChannels(ntariffs, sut) {
  let result = [];
  if (ntariffs == 1) ntariffs = 0;

  ['EAP' + sut, 'EAM' + sut, 'ERP' + sut, 'ERM' + sut].forEach(item => {
    for (let t = 0; t <= ntariffs; t++) {
      result.push({ chan: item + (t ? 'T' + t : ''), note: nameOfEnergy(item, t)});
    }
  });
  return result;
}

function nameOfEnergy(eid, t) {
  let tstr = t ? ' тариф ' + t : '';
  let itstr = ' всего ';
  let sutstr = ' за сутки ';
  let uptomonstr = ' на начало м-ца';
  switch (eid) {
    case 'EAP':
      return 'Энергия A+ ' + itstr + tstr;
    case 'EAM':
      return 'Энергия A- ' + itstr + tstr;
    case 'ERP':
      return 'Энергия R+ ' + itstr + tstr;
    case 'ERM':
      return 'Энергия R- ' + itstr + tstr;
    case 'EAPS':
      return 'Энергия A+ ' + sutstr + tstr;
    case 'EAMS':
      return 'Энергия A- ' + sutstr + tstr;
    case 'ERPS':
      return 'Энергия R+ ' + sutstr + tstr;
    case 'ERMS':
      return 'Энергия R- ' + sutstr + tstr;
    case 'EAPX':
      return 'Энергия A+ ' + uptomonstr + tstr;
    case 'EAMX':
      return 'Энергия A- ' + uptomonstr + tstr;
    case 'ERPX':
      return 'Энергия R+ ' + uptomonstr + tstr;
    case 'ERMX':
      return 'Энергия R- ' + uptomonstr + tstr;
    default:
  }
}

function meteringChannels(mid) {
  switch (mid) {
    case 'I':
    case 'U':
      return [1, 2, 3].map(item => ({
        chan: mid + item,
        note: nameOfMetering(mid) + ' ' + phase(item)
      }));

    case 'P':
    case 'Q':
    case 'S':
    case 'cos':
    case 'Kuf':
      return [0, 1, 2, 3].map(item => ({
        chan: mid + item,
        note: nameOfMetering(mid) + ' ' + phase(item)
      }));

    case 'F':
    case 'T':
      return [{ chan: mid, note: nameOfMetering(mid)}];

    default:
  }
}

function nameOfMetering(mid) {
  switch (mid) {
    case 'P':
      return 'Активная мощность';
    case 'Q':
      return 'Реактивная мощность';
    case 'S':
      return 'Полная мощность';
    case 'cos':
      return 'Коэффициент активной мощности';
    case 'Kuf':
      return 'Коэффициент искажения фазного напряжения';

    case 'I':
      return 'Ток';
    case 'U':
      return 'Напряжение ';
    case 'f':
      return 'Частота сети ';
    case 'T':
      return 'Температура ';
    case 'Е':
      return 'Энергия всего от сброса';

    case 'ЕS':
      return 'Энергия за текущие сутки';
    default:
  }
}

function phase(i) {
  return i ? ' по фазе ' + i : ' по всем фазам ';
}
