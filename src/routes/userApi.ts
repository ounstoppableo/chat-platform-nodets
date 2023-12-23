import jetValidator from 'jet-validator';
import { Router } from 'express';
import pool from '@src/mysql/pool';
import path, { resolve } from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { Group, RegisterInfo, UserInfo } from './types/userApi/userApi';
import IP2Region  from 'ip2region';
import { codeMapMsg, resCode } from './types/types';


const privateKey = fs.readFileSync(path.resolve(__dirname,'../../key/tokenKey.key'));
// **** Variables **** //

const userRouter = Router();


userRouter.post('/userLogin',(req,res)=>{
  const ip =req.headers['x-forwarded-for'];
  const avatarPath = path.resolve(__dirname,'../public/avatar/');
  const {username,password} = req.body;
  new Promise((res,rej)=>{
    pool.query('select username,password from users where username = ?',[username],(err,data)=>{
      if(err) {
        console.log(err);
        return rej('服务器错误');
      }
      if(data.length===0){
        const userInfo:RegisterInfo = {} as RegisterInfo;
        fs.readdir(avatarPath, (err, files) => {
          if (err) {
            console.error('错误的路径:', err);
            return rej('服务器错误');
          }
          const randomAvatar = Math.floor((Math.random()*files.length));
          userInfo.avatar = '/avatar/'+ files[randomAvatar];
          userInfo.username = username;
          userInfo.password = password;
          userInfo.isOnline = false;
          pool.query('select COUNT(*) from users',(err,data)=>{
            if(err) {
              console.log(err);
              return rej('服务器错误');
            }
            const count = data[0]['COUNT(*)'];
            let str = '';
            for(let i =0 ;i<5-`${count}`.length;i++) str+='0';
            const uid = str + count;
            userInfo.uid = uid;
            const query = new IP2Region();
            userInfo.region = query.search(ip as string)?.province.split('省')[0] || '未知';
            pool.getConnection((err,connection)=>{
              if(err) {
                console.log(err);
                return rej('服务器错误');
              }
              connection.beginTransaction((err)=>{
                if (err) {
                  connection.release(); // 释放连接回连接池
                  console.error('Error starting transaction:', err);
                  return rej('服务器错误');
                }
                connection.query('insert users set avatar=?,username=?,password=?,isOnline=?,uid=?,region=?',[userInfo.avatar,userInfo.username,userInfo.password,userInfo.isOnline,userInfo.uid,userInfo.region],(err,data)=>{
                  if(err) {
                    return connection.rollback(() => {
                      connection.release(); // 释放连接回连接池
                      console.error(err);
                      rej('服务器错误');
                    });
                  }
                  connection.query('insert groupRelationship set groupId = 1,username=?', [userInfo.username], (err, data) => {
                    if (err) {
                      return connection.rollback(() => {
                        connection.release(); // 释放连接回连接池
                        console.error(err);
                        rej('服务器错误');
                      });
                    }
                    connection.commit((commitError) => {
                      if (commitError) {
                        return connection.rollback(() => {
                          connection.release(); // 释放连接回连接池
                          console.error('Error committing transaction:', commitError);
                        });
                      }
                      // 释放连接回连接池
                      connection.release();
                      const privateKey = fs.readFileSync(path.resolve(__dirname,'../../key/tokenKey.key'));
                      const token = jwt.sign({ username, exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) }, privateKey);
                      return res(token);
                    });
                  });
                });
              });
            });
          });
        });
      }else {
        //密码正确返回token
        if(data[0].password===password){
          const privateKey = fs.readFileSync(path.resolve(__dirname,'../../key/tokenKey.key'));
          const token = jwt.sign({ username, exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) }, privateKey);
          return res(token);
        }else{
          return rej('密码错误');
        }
      }
    });
 
  }).then((data)=>{
    res.json({code:200,token:data});
  }).catch((err)=>{
    res.json({code:401,msg:err});
  });
});

userRouter.get('/userConfirm',(req,res)=>{
  const token = req.headers.authorization;
  const resData = {} as UserInfo;
  const initResData = (resData:any)=>{
    resData.avatar = '';
    resData.isLogin = false;
    resData.uid = '';
    resData.username = '';
  };
  if(token){
    new Promise((res,rej)=>{
      jwt.verify(token,privateKey,(err:any, decoded:any)=>{
        if(err){
          console.log(err);
          return rej(resCode.tokenErr);
        }
        const {username} = decoded;
        resData.username = username;
        pool.query('select avatar,uid from users where users.username = ? ',[username],(err,data)=>{
          if(err) {
            console.log(err);
            return rej(resCode.serverErr);
          }
          resData.avatar = data[0].avatar;
          resData.uid = data[0].uid;
          pool.query('select groupId from groupRelationship where username = ? ',[username],(err,data)=>{
            if(err) {
              console.log(err);
              return rej(resCode.serverErr);
            }
            const promises = [] as Promise<any>[];
            const groups = [] as Group[]; 
            data.forEach((item:string)=>{
              promises.push(new Promise((res,rej)=>{
                pool.query('select * from groups where groupId=?',[item],(err,data)=>{
                  if(err) {
                    console.log(err);
                    return rej(resCode.serverErr);
                  }
                  groups.push(data[0]);
                  res(data[0]);
                });
              }));
            });
            Promise.all(promises).then(()=>{
              resData.groups = groups;
              pool.query('update users set isOnline=1 where username = ?',[username],(err,data)=>{
                if(err) {
                  console.log(err);
                  return rej(resCode.serverErr);
                }
                resData.isLogin = true;
                res(resData);
              });
            },(err)=>rej(err));
          });
        });
      });
    }).then((data)=>{
      res.json({code: resCode.success,data,msg:codeMapMsg[resCode.success]});
    },(err)=>{
      initResData(resData);
      pool.query('select * from groups where groupId=1',(err2,data)=>{
        if(err2) {
          console.log(err2);
          return res.json({code:resCode.serverErr,data:resData,msg:codeMapMsg[resCode.serverErr]});
        }
        resData.groups = data;
        res.json({code:err,data:resData,msg:codeMapMsg[err]});
      });
    });
  }else {
    initResData(resData);
    pool.query('select * from groups where groupId=1',(err,data)=>{
      if(err) {
        console.log(err);
        return res.json({code:resCode.serverErr,data:resData,msg:codeMapMsg[resCode.serverErr]});
      }
      resData.groups = data;
      res.json({code: resCode.success,data:resData,msg: codeMapMsg[resCode.success]});
    });
  }
});


// **** Export default **** //

export default userRouter;
