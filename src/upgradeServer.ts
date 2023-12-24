import express from 'express';
import fs from 'fs';
import path from 'path';
import https from 'https';
import {Server } from 'socket.io';

const app:any = express();

const httpsServer = https.createServer({
  key: fs.readFileSync(path.resolve(__dirname,'../cert/server.key')),
  cert: fs.readFileSync(path.resolve(__dirname,'../cert/server.crt')),
}, app);
const io = new Server(httpsServer,{
  cors: {
    origin: 'https://localhost:5173',
  },
});

export {app,io};
export default httpsServer;