import jetValidator from 'jet-validator';
import { Router } from 'express';
import Paths from '../constants/Paths';
import pool from '@src/mysql/pool';
import {generalReceiveMsg, generalSendMsg, userInfo } from './chatApi/general';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
const initResMsg = (resMsg:generalSendMsg,type:any) =>{
  resMsg.type = type;
  resMsg.data = {} as userInfo;
  resMsg.data.groupIds = ['1'];
};
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
  const token = req.query.token as string;
  const resMsg = {} as generalSendMsg;
  if(token || token.length!==0){
    new Promise((res,rej)=>{
      jwt.verify(token,privateKey,(err:any, decoded:any)=>{
        if(err){
          console.log(err);
          return rej('tokenErr');
        }
        const {username} = decoded;
        pool.query('select avatar from users where users.username = ? ',[username],(err,data)=>{
          if(err) {
            console.log(err);
            return rej('serverErr');
          }
          resMsg.data = {} as userInfo;
          resMsg.data.avatar = data[0].avatar;
          pool.query('select groupId from groupRelationship where username = ? ',[username],(err,data)=>{
            if(err) {
              console.log(err);
              return rej('serverErr');
            }
            resMsg.data.groupIds = data.map((item:{groupId:string})=>item.groupId);
            pool.query('update users set isOnline=1 where username = ?',[username],(err,data)=>{
              if(err) {
                console.log(err);
                return rej('serverErr');
              }
              resMsg.data.isOnline = true;
              resMsg.type = 'getUserInfo';
              res(resMsg);
            });
          });
        });
      });
    }).then((data)=>{
      ws.send(JSON.stringify(data));
    },(err)=>{
      initResMsg(resMsg,err);
      ws.send(JSON.stringify(resMsg));
    });
  }else {
    initResMsg(resMsg,'tokenErr');
    ws.send(JSON.stringify(resMsg));
  }

  ws.on('message', (rawMsg:string)=> {
    const resMsg = {} as generalSendMsg;
    const msg:generalReceiveMsg = JSON.parse(rawMsg);
    if(msg.type==='login'){
      new Promise((res,rej)=>{
        jwt.verify(msg.data,privateKey,(err:any, decoded:any)=>{
          if(err){
            console.log(err);
            return rej('tokenErr');
          }
          const {username} = decoded;
          pool.query('select avatar from users where users.username = ? ',[username],(err,data)=>{
            if(err) {
              console.log(err);
              return rej('serverErr');
            }
            resMsg.data = {} as userInfo;
            resMsg.data.avatar = data[0].avatar;
            pool.query('select groupId from groupRelationship where username = ? ',[username],(err,data)=>{
              if(err) {
                console.log(err);
                return rej('serverErr');
              }
              resMsg.data.groupIds = data.map((item:{groupId:string})=>item.groupId);
              pool.query('update users set isOnline=1 where username = ?',[username],(err,data)=>{
                if(err) {
                  console.log(err);
                  return rej('serverErr');
                }
                resMsg.data.isOnline = true;
                resMsg.type = 'getUserInfo';
                res(resMsg);
              });
            });
          });
        });
      }).then((data)=>{
        ws.send(JSON.stringify(data));
      },(err)=>{
        initResMsg(resMsg,err);
        ws.send(JSON.stringify(resMsg));
      });
    }else if(msg.type === 'getGroups'){
      let groups:any[] = [];
      if(msg.data){
        const promises: Promise<any>[]= [];
        msg.data.forEach((item:string)=>{
          promises.push(new Promise((res,rej)=>{
            pool.query('select * from groups where groupId = ?',[item],(err,data)=>{
              if(err) {
                console.log(err);
                return rej('getGroupErr');
              }
              groups.push(...data);
              res(1);
            });
          }));
        });
        Promise.all(promises).then(()=>{
          ws.send(JSON.stringify({type:'getGroups',data:groups} as generalSendMsg));
        },(err)=>{
          ws.send(JSON.stringify({type:'getGroupErr',data:''} as generalSendMsg));
        });
      }else{
        pool.query('SELECT * FROM groups WHERE groupId = 1',(err,data)=>{
          if(err) {
            console.log(err);
            return ws.send(JSON.stringify({type:'getGroupErr',data:''} as generalSendMsg));
          }
          groups = [...data];
          ws.send(JSON.stringify({type:'getGroups',data:groups}));
        });
      }
    }
  });
});


// Add UserRouter
apiRouter.use(Paths.Chat.Base, chatRouter);



// **** Export default **** //

export default apiRouter;
