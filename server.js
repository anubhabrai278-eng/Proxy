// Loader: starts app.js. If app.js has any error, the error is shown in the browser
// (open the Render URL) instead of the deploy failing with no explanation.
process.on('uncaughtException', e => console.error('uncaught:', e && e.stack || e));
process.on('unhandledRejection', e => console.error('unhandled:', e && e.stack || e));
try {
  require('./app.js');
} catch (e) {
  const msg = 'STARTUP ERROR in app.js\n\n' + ((e && e.stack) || e) + '\n\nNode ' + process.version;
  console.error(msg);
  require('http').createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(msg);
  }).listen(process.env.PORT || 3000, '0.0.0.0');
}
