require('any-promise/register/bluebird');
require('dotenv').config({silent: true, path: __dirname + '/config/.env'});

var mcHosts = process.env.MEMCACHED_HOSTS.split(',');
var API = require('./dist/index').default;
var api = new API(mcHosts, Date);

module.exports = api;
