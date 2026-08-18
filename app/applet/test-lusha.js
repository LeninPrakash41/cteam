import https from 'https';

const req = https.request('https://api.lusha.com/person', {
  method: 'POST',
  headers: {
    'api_key': 'test',
    'Content-Type': 'application/json'
  }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log(res.statusCode, data));
});
req.write(JSON.stringify({ firstName: 'test' }));
req.end();
