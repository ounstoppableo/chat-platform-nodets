import jetValidator from 'jet-validator';
import { Router } from 'express';
import Paths from '../constants/Paths';
import pool from '@src/mysql/pool';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
// const initResMsg = (resMsg:generalSendMsg,type:any) =>{
//   resMsg.type = type;
//   resMsg.data = {} as userInfo;
//   resMsg.data.groupIds = ['1'];
// };
const privateKey = fs.readFileSync(path.resolve(__dirname,'../../key/tokenKey.key'));
// **** Variables **** //

const apiRouter = Router();
// validate = jetValidator();

// ** Add UserRouter ** //

const chatRouter = Router();

chatRouter.get('/',(req,res)=>{
  res.json({a:1111});
});


//初始化服务
chatRouter.ws('/',(ws,req)=>{

});


// Add UserRouter
apiRouter.use(Paths.Chat.Base, chatRouter);



// **** Export default **** //

export default apiRouter;
