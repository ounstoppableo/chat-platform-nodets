import jetValidator from 'jet-validator';
import { Router } from 'express';
import pool from '@src/mysql/pool';
import path, { resolve } from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { Group, RegisterInfo, UserInfo } from './types/userApi/userApi';
import IP2Region  from 'ip2region';
import { Res, codeMapMsg, resCode } from './types/types';
import redisClient from '@src/redis/connect';
import { ServerToUserMsg, TotalMsg, userToServerMsg } from './types/chatApi/chatApi';


const privateKey = fs.readFileSync(path.resolve(__dirname,'../../key/tokenKey.key'));
// **** Variables **** //

const userRouter = Router();

/*
  初步设想是先进行redis的插入/查询再进行mysql的插入/查询
  但是要保证数据一致性又是一个问题
  该怎么做呢？？
*/


//用户登录逻辑，第一次登录自动注册
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

//用户token校验，返回用户信息
userRouter.get('/userConfirm',(req,res:{json:(param:Res<any>)=>void})=>{
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
            data.forEach((item:any)=>{
              promises.push(new Promise((res,rej)=>{
                pool.query('select * from groups where groupId=?',[item.groupId],(err,data)=>{
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

//查询组成员
//是否需要token校验？
userRouter.get('/groupMembers/:groupId',(req,res:{json:(param:Res<any>)=>void})=>{
  const groupMembers = [] as any;
  const groupId = req.params.groupId;
  if(groupId){
    new Promise((res,rej)=>{
      pool.query('select username from groupRelationship where groupId = ?',[groupId],(err,data)=>{
        if(err) {
          console.log(err);
          return rej(resCode.serverErr);
        }
        const usernames = data;
        const promises:Promise<any>[] = usernames.map((item:any)=>new Promise((res,rej)=>{
          pool.query('select username,avatar,uid,isOnline from users where username=?',[item.username],(err,data)=>{
            if(err){
              console.log(err);
              return rej(resCode.serverErr);
            }
            groupMembers.push(data[0]);
            res(1);
          });
        }),
        );
        Promise.all(promises).then(()=>{
          res(groupMembers);
        },(err)=>{
          rej(err);
        });
      });
    }).then((data)=>{
      res.json({code: resCode.success,data:data,msg:codeMapMsg[resCode.success]});
    },(err)=>{
      res.json({code: err,data:groupMembers,msg:codeMapMsg[err]});
    });
  }else {
    res.json({code: resCode.paramsErr,data:groupMembers,msg:codeMapMsg[resCode.paramsErr]});
  }
});


//获取群消息
userRouter.get('/groupMsg/:groupId',(req,res:{json:(param:Res<ServerToUserMsg[]>)=>void})=>{
  const groupId = req.params.groupId;
  const resData:ServerToUserMsg[] = [];
  new Promise((res,rej)=>{
    pool.query('select * from gmessage where groupId = ?',[groupId],(err,data)=>{
      if(err){
        console.log(err);
        return rej(resCode.serverErr);
      }
      const promises = data.map((item:any,index:number)=>{
        return new Promise((res,rej)=>{
          pool.query('select avatar from users where username = ?',[item.username],(err,data)=>{
            if(err) {
              console.log(err);
              return rej(resCode.serverErr);
            }
            res(data[0] as string);
          });
        }).then((avatar:any)=>{
          const temp = {
            id:item.id,avatar:avatar.avatar,username:item.username,room:item.groupId,msg:item.text,time:item.time,timestamp:item.timestamp,likes:item.likes,dislikes:item.dislikes,
          };
          resData[index] = temp;
        });
      });
      Promise.all(promises).then(()=>{
        res(1);
      },(err)=>{
        return rej(err);
      });
    });
  }).then(()=>{
    console.log(resData);
    res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
  },(err)=>{
    res.json({code:err,data:resData,msg:codeMapMsg[err]});
  });
});

//获取用户加入的所有群的消息
userRouter.get('/totalMsg/:username?',(req,res:{json:(param:Res<TotalMsg>)=>void})=>{
  const username = req.params.username;
  const resData:TotalMsg =  {} as TotalMsg;
  if(username){
    new Promise((res,rej)=>{
      pool.query('select * from groupRelationship where username = ?',[username],(err,data)=>{
        if(err) {
          console.log(err);
          return rej(err);
        }
        const promises = data.map((item:{ groupId: string, username: string })=>{
          return new Promise((res2,rej2)=>{
            pool.query('select * from gmessage where groupId = ?',[item.groupId],(err,data)=>{
              if(err) {
                console.log(err);
                return rej2(err);
              }
              resData[item.groupId] = data.map((item2:any)=>({
                id:item2.id,username:item2.username,room:item2.groupId,msg:item2.text,time:item2.time,timestamp:item2.timestamp,likes:item2.likes,dislikes:item2.dislikes,
              }));
              const promises2 = resData[item.groupId].map((item3:any,index:number)=>{
                return new Promise((res3,rej3)=>{
                  pool.query('select avatar from users where username = ?',[item3.username],(err,avatar)=>{
                    if(err) {
                      console.log(err);
                      return rej3(err);
                    }
                    resData[item.groupId][index].avatar  = avatar[0].avatar;
                    res3(1);
                  });
                });
              });
              Promise.all(promises2).then(()=>{
                res2(1);
              },(err)=>{
                rej2(err);
              });
            });
          });
        });
        Promise.all(promises).then(()=>{
          res(1);
        },(err)=>{
          rej(err);
        });
      });
    }).then(()=>{
      res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
    },(err)=>{  
      res.json({code:err,data:resData,msg:codeMapMsg[err]});
    });
  }else {
    new Promise((res,rej)=>{
      pool.query('select * from gmessage where groupId = 1',(err,data)=>{
        if(err) {
          console.log(err);
          return rej(err);
        }
        resData['1'] = data.map((item:any)=>({
          id:item.id,username:item.username,room:item.groupId,msg:item.text,time:item.time,timestamp:item.timestamp,likes:item.likes,dislikes:item.dislikes,
        }));
        const promises = resData['1'].map((item2:any,index:number)=>{
          return new Promise((res2,rej2)=>{
            pool.query('select avatar from users where username = ?',[item2.username],(err,avatar)=>{
              if(err) {
                console.log(err);
                return rej2(err);
              }
              resData['1'][index].avatar  = avatar[0].avatar;
              res2(1);
            });
          });
        });
        Promise.all(promises).then(()=>{
          res(1);
        },(err)=>{
          rej(err);
        });
      });
    }).then(()=>{
      res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
    },(err)=>{  
      res.json({code:err,data:resData,msg:codeMapMsg[err]});
    });
  }
});

// **** Export default **** //

export default userRouter;
