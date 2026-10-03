const fs = require('fs'); fs.writeFileSync('wrangler.jsonc', fs.readFileSync('wrangler.jsonc', 'utf8').replace('new_classes', 'new_sqlite_classes'));
