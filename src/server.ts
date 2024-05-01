/**
 * Setup express server.
 */
import {app} from '@src/upgradeServer';


import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import path from 'path';
import helmet from 'helmet';
import express, { Request, Response, NextFunction } from 'express';

import logger from 'jet-logger';

import 'express-async-errors';

import '@src/routes/chatApi';
import Paths from '@src/constants/Paths';

import EnvVars from '@src/constants/EnvVars';
import HttpStatusCodes from '@src/constants/HttpStatusCodes';

import { NodeEnvs } from '@src/constants/misc';
import { RouteError } from '@src/other/classes';
import userRouter from '@src/routes/userApi';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import { codeMapMsg, resCode } from './routes/types/types';
import { redisClient } from '@src/redis/connect';
import getClientIp from './util/getIp';


const privateKey = fs.readFileSync(path.resolve(__dirname,'../key/tokenKey.key'));
const startTime = Math.floor(Date.now()/1000);

//jwt中间件
function jwtExControl(req:any, res:any, next:any){
  const token = req.headers.authorization||req.cookies.username;
  if(token){
    jwt.verify(token,privateKey,(err:any,decoded:any)=>{
      if(err) {
        res.clearCookie('username');
        return res.json({code:resCode.tokenErr,data:{},msg:codeMapMsg[resCode.tokenErr]});
      }
      if(decoded.iat <= startTime) {
        res.clearCookie('username');
        const ip = getClientIp(req);
        redisClient.then(async (redisClient:any)=>{
          redisClient.del('loginCount:'+ip);
          const userInfo = JSON.parse(await redisClient.hGet('userInfo',decoded.username) as string);
          if(userInfo){
            userInfo.isLogin = false;
            userInfo.isOnline = false;
            redisClient.hSet('userInfo',decoded.username,JSON.stringify(userInfo));
          }
        });
        return res.json({code:resCode.tokenErr,data:{},msg:codeMapMsg[resCode.tokenErr]});
      }
      next();
    });
  }else {
    next();
  }
}

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(cookieParser(EnvVars.CookieProps.Secret));

if(process.env.NODE_ENV !== 'dev'){
  app.use(jwtExControl);
}

// Show routes called in console during development
if (EnvVars.NodeEnv === NodeEnvs.Dev.valueOf()) {
  app.use(morgan('dev'));
}

// Security
if (EnvVars.NodeEnv === NodeEnvs.Production.valueOf()) {
  app.use(helmet());
}

// Add APIs, must be after middleware
app.use(Paths.User, userRouter);

// Add error handler
app.use((
  err: Error,
  _: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
) => {
  if (EnvVars.NodeEnv !== NodeEnvs.Test.valueOf()) {
    logger.err(err, true);
  }
  let status = HttpStatusCodes.BAD_REQUEST;
  if (err instanceof RouteError) {
    status = err.status;
  }
  return res.status(status).json({ error: err.message });
});


// ** Front-End Content ** //

// Set views directory (html)
// const viewsDir = path.join(__dirname, 'views');
// app.set('views', viewsDir);

// Set static directory (js and css).
const staticDir = path.join(__dirname, 'public');
app.use(express.static(staticDir));

// **** Export default **** //

// export default app;

export {default as httpsServer} from './upgradeServer';