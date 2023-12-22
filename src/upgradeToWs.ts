import express from 'express';
import expressWs from 'express-ws';
import fs from 'fs';
import path from 'path';
import https from 'https';

const app:any = express();

const httpsServer = https.createServer({
  key: fs.readFileSync(path.resolve(__dirname,'../cert/server.key')),
  cert: fs.readFileSync(path.resolve(__dirname,'../cert/server.crt')),
}, app);

expressWs(app,httpsServer);

export {app};
export default httpsServer;