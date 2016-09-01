import fs from 'fs';

const readFile = function(module) {
  try {
    const path = require.resolve(module);
    console.log(path);
    return fs.readFileSync(path);
  } catch (e) {
    console.error(e);
    return undefined;
  }
};

export default readFile;
