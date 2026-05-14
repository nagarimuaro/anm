const sqlite3 = require('sqlite3');
const fs = require('fs');
const paths = [
  'C:/Users/User/AppData/Roaming/anm/data/anm.sqlite',
  'C:/Users/User/Downloads/anm/anm/data/kiosk.db',
  'C:/Users/User/Downloads/anm/anm/data/anm.sqlite'
];

paths.forEach(p => {
  if (!fs.existsSync(p)) {
    console.log(`DB not found: ${p}`);
    return;
  }
  const db = new sqlite3.Database(p, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      console.error(`Error opening ${p}:`, err);
      return;
    }
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
      if (err) {
        console.error(`Error reading tables in ${p}:`, err);
        return;
      }
      console.log(`\n--- Tables in ${p} ---`);
      console.log(rows.map(r => r.name).join(', '));
      
      rows.forEach(row => {
        // Just dump all tables since they might be small configuration tables
        db.all(`SELECT * FROM ${row.name}`, (err, data) => {
          if (!err && data && data.length > 0) {
            // Check if stringified data contains token
            const dataStr = JSON.stringify(data);
            if (dataStr.includes('device_token') || dataStr.includes('token') || dataStr.includes('RKI5CVBsiL')) {
               console.log(`\nFound token/device_token in table ${row.name} inside ${p}:`);
               console.log(dataStr);
            }
          }
        });
      });
    });
  });
});
