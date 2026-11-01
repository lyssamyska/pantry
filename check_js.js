const fs = require('fs');
const content = fs.readFileSync('views/planner.ejs', 'utf8');
const start = content.indexOf('<script>');
const end = content.lastIndexOf('</script>');
if (start > 0 && end > start) {
  const script = content.substring(start + 8, end);
  console.log('First 200 chars:', JSON.stringify(script.substring(0, 200)));
  // Find the position of the bad regex
  const regexPatterns = ['/[^/]+\//g', '/\[^/]+\/u', '/[^/]+\/y'];
  for (const p of regexPatterns) {
    try { new RegExp(p); } catch(e) { console.log('Pattern test:', p, e.message); }
  }
  // Try to find regex literals
  const lines = script.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.match(/\/\[[^/]*\//)) {
      console.log('Line', i+1, 'has potential regex:', l.substring(0, 80));
    }
  }
}
