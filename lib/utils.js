/**
 * utils.js
 */

exports.byorder = byorder;

/** Функция сортировки используется в качестве вызываемой функции для сортировки массива ОБЪЕКТОВ
 *   arr.sort(hut.byorder('place,room','D')
 *   Возвращает функцию сравнения
 *
 *    @param {String}  ordernames - имена полей для сортировки через запятую
 *    @param {String}   direction: D-descending else ascending
 *    @return {function}
 *
 **/
function byorder(ordernames, direction, parsingInt) {
  let arrForSort = [];
  const dirflag = direction == 'D' ? -1 : 1; // ascending = 1, descending = -1;

  if (ordernames && typeof ordernames == 'string') arrForSort = ordernames.split(',');

  return function(o, p) {
    if (typeof o != 'object' || typeof p != 'object') return 0;
    if (arrForSort.length == 0) return 0;

    for (let i = 0; i < arrForSort.length; i++) {
      let a;
      let b;
      let name = arrForSort[i];

      a = o[name];
      b = p[name];
      if (a != b) {
        if (parsingInt) {
          let astr = String(a);
          let bstr = String(b);
          if (!isNaN(parseInt(astr, 10)) && !isNaN(parseInt(bstr, 10))) {
            return parseInt(astr, 10) < parseInt(bstr, 10) ? -1 * dirflag : 1 * dirflag;
          }
        }

        // сравним как числа
        if (!isNaN(Number(a)) && !isNaN(Number(b))) {
          return Number(a) < Number(b) ? -1 * dirflag : 1 * dirflag;
        }

        // одинаковый тип, не числа
        if (typeof a === typeof b) {
          return a < b ? -1 * dirflag : 1 * dirflag;
        }

        return typeof a < typeof b ? -1 * dirflag : 1 * dirflag;
      }
    }
    return 0;
  };
}