const res = await fetch('https://api.lusha.com/person/search', {
  method: 'POST',
  headers: {
    'api_key': 'test',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ firstName: 'test' })
});
console.log(res.status, await res.text());
