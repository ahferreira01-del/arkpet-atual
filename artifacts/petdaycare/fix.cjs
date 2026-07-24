const fs = require('fs');
let code = fs.readFileSync('src/pages/financial/index.tsx', 'utf8');

const regex = /^\s*if\s*\(isLoading\)\s*return\s*<div[^>]*>.*?<\/div>;\s*$/gm;
let lines = code.split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].match(/^\s*if\s*\(isLoading\)\s*return\s*<div/)) {
    // found the line. 
    let matchedLine = lines[i];
    lines.splice(i, 1);
    
    // now find the next return in the same scope.
    for (let j = i; j < lines.length; j++) {
      if (lines[j].match(/^\s*return\s*\(/)) {
        lines.splice(j, 0, matchedLine);
        break;
      }
    }
  }
}
fs.writeFileSync('src/pages/financial/index.tsx', lines.join('\n'));
console.log('Fixed hook orders!');
