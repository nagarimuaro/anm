const https = require('https');
const API_KEY = 'AIzaSyBwunJnqtK49sYQwhVkqFEEuDpGHQVY5uw';

const reqOptions = {
  hostname: 'generativelanguage.googleapis.com',
  port: 443,
  path: `/v1beta/models?key=${API_KEY}`,
  method: 'GET',
};

const req = https.request(reqOptions, (res) => {
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    const models = JSON.parse(responseData).models;
    if (models) {
      console.log('Available models for this key:');
      models.forEach(m => console.log(m.name));
    } else {
      console.log('Response:', responseData);
    }
  });
});

req.on('error', (e) => {
  console.error('Error:', e);
});

req.end();
