const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const root = path.join(__dirname, '..');
let checked = 0;
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') walk(fullPath);
    } else if (entry.name.endsWith('.ejs')) {
      ejs.compile(fs.readFileSync(fullPath, 'utf8'), { filename: fullPath });
      checked += 1;
    }
  }
}
walk(path.join(root, 'views'));
console.log(`Project template check passed: ${checked} EJS templates compiled successfully.`);
console.log('This check does not connect to MongoDB or send test emails.');
