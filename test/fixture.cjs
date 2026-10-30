const { DEFAULTS, productFor, parseInventory: parse } = require('../core.cjs');
const STORES = {
  R001: 'Apple Test One',
  R002: 'Apple Test Two',
  R003: 'Apple Test Three',
  R004: 'Apple Test Four',
};
const CONFIG = { ...DEFAULTS, zip: '10001', catalog: STORES, stores: Object.keys(STORES) };
const PRODUCT = { ...productFor(CONFIG), part: 'TEST123/A' };
const parseInventory = (data, selected, at) => parse(data, selected, at, PRODUCT.part, STORES);
module.exports = { CONFIG, PRODUCT, STORES, parseInventory };
