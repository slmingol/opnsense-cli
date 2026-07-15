const axios = require('axios');
const https = require('https');
require('dotenv').config();

function getClient() {
  const host   = process.env.OPNSENSE_HOST;
  const key    = process.env.OPNSENSE_API_KEY;
  const secret = process.env.OPNSENSE_API_SECRET;

  if (!host || !key || !secret) {
    throw new Error(
      'Missing required env vars: OPNSENSE_HOST, OPNSENSE_API_KEY, OPNSENSE_API_SECRET'
    );
  }

  const client = axios.create({
    baseURL: host,
    auth: { username: key, password: secret },
    headers: { 'Accept': 'application/json' },
    httpsAgent: new https.Agent({
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
    }),
  });

  // OPNsense: GET with Content-Type causes 400; POST needs {} body or gets 400/411
  client.interceptors.request.use(config => {
    if (config.method === 'post') {
      config.headers['Content-Type'] = 'application/json';
      if (config.data === undefined) config.data = {};
    }
    return config;
  });

  client.interceptors.response.use(
    response => response,
    error => {
      if (error.response) {
        console.error(`OPNsense API Error: ${error.response.status} - ${error.response.statusText}`);
        const d = error.response.data;
        if (d?.message)     console.error(`Message: ${d.message}`);
        if (d?.validations) console.error('Validations:', JSON.stringify(d.validations));
      } else if (error.request) {
        console.error('No response from OPNsense. Check OPNSENSE_HOST and network.');
      } else {
        console.error('Error:', error.message);
      }
      return Promise.reject(error);
    }
  );

  return client;
}

module.exports = { getClient };
