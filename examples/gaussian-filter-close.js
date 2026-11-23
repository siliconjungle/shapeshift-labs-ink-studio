const { close } = require('./gaussian-filter/study.js');
module.exports = () => ({ id: 'aster-relay-close', name: 'Aster Relay · Close', seed: 33, build: close });
