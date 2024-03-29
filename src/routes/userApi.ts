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
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import { validateString } from '@src/util/validateString';
import formatBytes from '@src/util/byteFormat';

// 设置文件上传的存储路径和文件名
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if(file.fieldname==='image') cb(null, path.resolve(__dirname+'/../public/image'));
    if(file.fieldname==='file') cb(null, path.resolve(__dirname+'/../public/files'));
  },
  filename: function (req, file, cb) {
    if(file.fieldname==='image')  cb(null, uuidv4() + path.extname(file.originalname)); // 保留原始文件的扩展名
    if(file.fieldname==='file') cb(null, uuidv4() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });



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
  if(validateString(username)) return res.json({code:resCode.paramsErr,data:{},msg:codeMapMsg[resCode.paramsErr]});
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
    res.cookie('username', data, { maxAge: Math.floor(Date.now() / 1000) + (60 * 60 * 24), httpOnly: true });
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
          pool.query('select groupId from groupRelationship where username = ? and isShow=1',[username],(err,data)=>{
            if(err) {
              console.log(err);
              return rej(resCode.serverErr);
            }
            const promises = [] as Promise<any>[];
            const groups = [] as Group[]; 
            data.forEach((item:any)=>{
              promises.push(new Promise((res,rej)=>{
                pool.query('select *,username AS authorBy from groups where groupId=?',[item.groupId],(err,data)=>{
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
      pool.query('select *,username AS authorBy from groups where groupId=1',(err2,data)=>{
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
    pool.query('select *,username AS authorBy from groups where groupId=1',(err,data)=>{
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
          pool.query('select username,avatar,uid,isOnline,region from users where username=?',[item.username],(err,data)=>{
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
            id:item.id,avatar:avatar.avatar,username:item.username,room:item.groupId,msg:item.text,time:item.time,timestamp:item.timestamp,likes:item.likes,dislikes:item.dislikes,type:item.type,src:item.src,fileName:item.fileName,fileSize:item.fileSize,
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
  const token = req.headers.authorization;
  if(username){
    if(token){
      jwt.verify(token,privateKey,(err:any, decoded:any)=>{
        if(err) {
          return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
        }
        if(decoded.username!==username) return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
        new Promise((res,rej)=>{
          pool.query('select * from groupRelationship where username = ?',[username],(err,data)=>{
            if(err) {
              console.log(err);
              return rej(resCode['serverErr']);
            }
            const promises = data.map((item:{ groupId: string, username: string,isShowMsg:string })=>{
              return new Promise((res2,rej2)=>{
                pool.query('select * from gmessage where groupId = ?',[item.groupId],(err,data)=>{
                  if(err) {
                    console.log(err);
                    return rej2(resCode['serverErr']);
                  }
                  const isShowMsg:string[] = JSON.parse(item.isShowMsg);
                  resData[item.groupId] = data.filter((msg:any)=>!isShowMsg.includes(msg.id+'')).map((item2:any)=>({
                    id:item2.id,username:item2.username,room:item2.groupId,msg:item2.text,time:item2.time,timestamp:item2.timestamp,likes:item2.likes,dislikes:item2.dislikes,atMembers:JSON.parse(item2.atMembers),forMsg:item2.forMsg,type:item2.type,src:item2.src,fileName:item2.fileName,fileSize:item2.fileSize,
                  }));
                  const promises2 = resData[item.groupId].map((item3:any,index:number)=>{
                    return new Promise((res3,rej3)=>{
                      pool.query('select avatar from users where username = ?',[item3.username],(err,avatar)=>{
                        if(err) {
                          console.log(err);
                          return rej3(resCode['serverErr']);
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
      });
    }else {
      return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
    }
  }else {
    new Promise((res,rej)=>{
      pool.query('select * from gmessage where groupId = 1',(err,data)=>{
        if(err) {
          console.log(err);
          return rej(err);
        }
        resData['1'] = data.map((item:any)=>({
          id:item.id,username:item.username,room:item.groupId,msg:item.text,time:item.time,timestamp:item.timestamp,likes:item.likes,dislikes:item.dislikes,atMembers:JSON.parse(item.atMembers),forMsg:item.forMsg,type:item.type,src:item.src,fileName:item.fileName,fileSize:item.fileSize,
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

//获取系统消息
userRouter.get('/getSystemMsg',(req,res:{json:(param:Res<any>)=>void})=>{
  const resData:any =  {} as any;
  const token = req.headers.authorization;
  if(token){
    jwt.verify(token,privateKey,(err:any, decoded:any)=>{
      if(err) {
        return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
      }
      const {username} = decoded;
      pool.query('select * from systemMsg where toName = ? and done=\'padding\' or fromName=? and done=\'failed\' or toName = ? and type=\'exitGroup\' and done=\'success\' or toName = ? and type=\'kickOutGroup\' and done=\'success\' or toName = ? and type=\'delGroup\' and done=\'success\'',[username,username,username,username,username],(err,data)=>{
        if(err) {
          console.log(err);
          return res.json({code:resCode.serverErr,data:resData,msg:codeMapMsg[resCode.serverErr]});
        }
        resData.result = data;
        return res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
      });
    });
  }else {
    return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
  }
});
//删除系统消息
userRouter.delete('/delSystemInfo/:msgId',(req,res:{json:(param:Res<any>)=>void})=>{
  const resData:any =  {} as any;
  const {msgId} = req.params;
  const token = req.headers.authorization;
  if(token){
    jwt.verify(token,privateKey,(err:any, decoded:any)=>{
      if(err) {
        return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
      }});
    pool.query('delete from systemMsg where msgId=?',[msgId],(err,data)=>{
      if(err){
        console.log(err);
        return res.json({code:resCode.serverErr,data:resData,msg:codeMapMsg[resCode.serverErr]});
      }
      return res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
    });
  }else {
    return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
  }
});
//获取好友
userRouter.get('/getFriends',(req,res:{json:(param:Res<any>)=>void})=>{
  const resData:any =  {result:[]} as any;
  const token = req.headers.authorization;
  if(token){
    jwt.verify(token,privateKey,(err:any, decoded:any)=>{
      if(err) {
        return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
      }
      const {username} = decoded;
      new Promise((resolve,reject)=>{
        pool.query('select * from relationship where username=? or friendName=?',[username,username],(err,data)=>{
          if(err){
            console.log(err);
            return reject(resCode['serverErr']);
          }
          const friends = data.map((item:any)=>{
            if(item.username===username) return {username:item.friendName as string,groupId:item.groupId,groupName:item.groupName};
            return {username:item.username as string,groupId:item.groupId,groupName:item.groupName};
          });
          const promises = friends.map((friend:any)=>{
            return new Promise((res2,rej2)=>{
              pool.query('select username,region,avatar,isOnline,uid from users where username = ?',[friend.username],(err,data)=>{
                if(err){
                  console.log(err);
                  return rej2(resCode['serverErr']);
                }
                resData.result.push({...data[0],groupId:friend.groupId,groupName:friend.groupName});
                res2(1);
              });
            });
          });
          Promise.all(promises).then(()=>{
            resolve(1);
          },(err)=>{
            reject(err);
          });
        });
      }).then(()=>{
        return res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
      },(err)=>{
        return res.json({code:err,data:resData,msg:codeMapMsg[err]});
      });
    });
  }else {
    return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
  }
});

//创建群聊
userRouter.get('/createGroup',(req,res:{json:(param:Res<any>)=>void})=>{
  const resData:any =  {result:[]} as any;
  const {groupName,avatar} = req.query;
  const token = req.headers.authorization;
  if(groupName&&validateString(groupName as string)) return res.json({code:resCode.paramsErr,data:resData,msg:codeMapMsg[resCode.paramsErr]});
  if(token){
    jwt.verify(token,privateKey,(err:any, decoded:any)=>{
      if(err) {
        return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
      }
      const {username} = decoded;
      pool.query('select count(*) from groups where username =? and type=\'group\'',[username],(err,data)=>{
        if(err){
          console.log(err);
          return res.json({code:resCode.serverErr,data:resData,msg:codeMapMsg[resCode.serverErr]});
        }
        if(data[0]['count(*)']>=5) return res.json({code:resCode.limitErr,data:resData,msg:codeMapMsg[resCode.limitErr]});
        new Promise((resolve,reject)=>{
          pool.getConnection((err,connection)=>{
            if(err) {
              console.log(err);
              return reject(resCode['serverErr']);
            }
            connection.beginTransaction((err)=>{
              if (err) {
                connection.release(); // 释放连接回连接池
                console.error('Error starting transaction:', err);
                return reject(resCode['serverErr']);
              }
              const groupId= uuidv4();
              connection.query('insert into groups set groupName=?,gavatar=?,groupId=?,username=?,type=\'group\',time=?',[groupName,avatar,groupId,username,dayjs(new Date()).format('YYYY-MM-DD HH:mm:ss')],(err,data)=>{
                if(err) {
                  return connection.rollback(() => {
                    connection.release(); // 释放连接回连接池
                    console.error('Error starting transaction:', err);
                    reject(resCode['serverErr']);
                  });
                }
                connection.query('insert into groupRelationship set groupId=?,username=?',[groupId,username],(err,data)=>{
                  if(err) {
                    return connection.rollback(() => {
                      connection.release(); // 释放连接回连接池
                      console.error('Error starting transaction:', err);
                      reject(resCode['serverErr']);
                    });
                  }
                  connection.commit((commitError) => {
                    if (commitError) {
                      return connection.rollback(() => {
                        connection.release(); // 释放连接回连接池
                        console.error('Error committing transaction:', commitError);
                        reject(resCode['serverErr']);
                      });
                    }
                    // 释放连接回连接池
                    connection.release();
                    return resolve(1);
                  });
                
                });
              });
            });
          });
        }).then(()=>{
          return res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
        },(err)=>{
          return res.json({code:err,data:resData,msg:codeMapMsg[err]});
        });

      });
    });
  }else {
    return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
  }
});

//获取用户下的所有群
userRouter.get('/getGroups',(req,res:{json:(param:Res<any>)=>void})=>{
  const resData:any =  {result:[]} as any;
  const token = req.headers.authorization;
  if(token){
    jwt.verify(token,privateKey,(err:any, decoded:any)=>{
      if(err) {
        return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
      }
      const {username} = decoded;
      pool.query('select groups.*,groups.username AS authorBy from groupRelationship,groups where groupRelationship.username=? and groupRelationship.groupId=groups.groupId and groupRelationship.isShow=1',[username],(err,data)=>{
        if(err) {
          console.log(err);
          return res.json({code:resCode.serverErr,data:resData,msg:codeMapMsg[resCode.serverErr]});
        }
        resData.result = data;
        res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
      });
    });
  }else {
    pool.query('select *,groups.username AS authorBy from groups where groupId=\'1\'',(err,data)=>{
      if(err) {
        console.log(err);
        return res.json({code:resCode.serverErr,data:resData,msg:codeMapMsg[resCode.serverErr]});
      }
      resData.result = data;
      res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
    });
  }
});

//图片上传功能
userRouter.post('/uploadImage',upload.single('image'),(req:any,res:{json:(param:Res<any>)=>void})=>{
  const resData:any =  {result:[]} as any;
  const token = req.cookies.username;
  const filePath = req.file.path;
  const fileName = req.file.filename;
  if(token){
    jwt.verify(token,privateKey,(err:any, decoded:any)=>{
      if(err) {
        fs.unlink(filePath, (err) => {
          if (err) {
            console.error('文件删除失败：', err);
          }
          console.log('文件删除成功');
        });
        return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
      }
      resData.src = '/image/' +fileName;
      res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
    });
  }else {
    return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
  }
});

//文件上传功能
userRouter.post('/uploadFile',upload.single('file'),(req:any,res:{json:(param:Res<any>)=>void})=>{
  const resData:any =  {result:[]} as any;
  const token = req.cookies.username;
  const filePath = req.file.path;
  const fileName = req.file.filename;
  if(token){
    jwt.verify(token,privateKey,(err:any, decoded:any)=>{
      if(err) {
        fs.unlink(filePath, (err) => {
          if (err) {
            console.error('文件删除失败：', err);
          }
          console.log('文件删除成功');
        });
        return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
      }
      resData.src = '/files/' +fileName;
      resData.originalname = decodeURIComponent(escape(req.file.originalname));
      resData.size = formatBytes(req.file.size);
      res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
    });
  }else {
    return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
  }
});


//同意加群
userRouter.post('/acceptJoinGroup',(req,res:{json:(param:Res<any>)=>void})=>{
  const resData:any =  {result:[]} as any;
  const {systemMsg} = req.body;
  const token = req.headers.authorization;
  if(token){
    jwt.verify(token,privateKey,(err:any, decoded:any)=>{
      if(err) {
        return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
      }
      const {username} = decoded;
      if(username===systemMsg.toName) {
        pool.query('select * from groups where groupId=?',[systemMsg.groupId],(err,data)=>{
          if(err) {
            return res.json({code:resCode.serverErr,data:resData,msg:codeMapMsg[resCode.serverErr]});
          }
          if(data.length===0) return res.json({code:resCode.inexistenceErr,data:resData,msg:codeMapMsg[resCode.inexistenceErr]});
          new Promise((resolve,reject)=>{
            pool.getConnection((err,connection)=>{
              if(err) {
                console.log(err);
                return reject(resCode['serverErr']);
              }
              connection.beginTransaction((err)=>{
                if (err) {
                  connection.release(); // 释放连接回连接池
                  console.error('Error starting transaction:', err);
                  return reject(resCode['serverErr']);
                }
                connection.query('update systemMsg set done="success" where msgId=?',[systemMsg.msgId],(err,data)=>{
                  if(err) {
                    return connection.rollback(() => {
                      connection.release(); // 释放连接回连接池
                      console.error('Error starting transaction:', err);
                      reject(resCode['serverErr']);
                    });
                  }
                  connection.query('insert into groupRelationship set groupId=?,username=?',[systemMsg.groupId,systemMsg.toName],(err,data)=>{
                    if(err) {
                      return connection.rollback(() => {
                        connection.release(); // 释放连接回连接池
                        console.error('Error starting transaction:', err);
                        reject(resCode['serverErr']);
                      });
                    }
                    connection.commit((commitError) => {
                      if (commitError) {
                        return connection.rollback(() => {
                          connection.release(); // 释放连接回连接池
                          console.error('Error committing transaction:', commitError);
                          reject(resCode['serverErr']);
                        });
                      }
                      // 释放连接回连接池
                      connection.release();
                      return resolve(1);
                    });
                  
                  });
                });
              });
            });
          }).then(()=>{
            return res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
          },(err)=>{
            return res.json({code:err,data:resData,msg:codeMapMsg[err]});
          });
        });
      }else {
        return res.json({code:resCode.paramsErr,data:resData,msg:codeMapMsg[resCode.paramsErr]});
      }
    });
  }else {
    return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
  }
});

//关闭对话框
userRouter.post('/closeChat',(req,res:{json:(param:Res<any>)=>void})=>{
  const resData:any =  {result:[]} as any;
  const {group}:{group:Group} = req.body;
  const token = req.headers.authorization;
  if(token){
    jwt.verify(token,privateKey,(err:any, decoded:any)=>{
      if(err) {
        return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
      }
      const {username} = decoded;
      if(group.type!=='p2p'){
        return res.json({code:resCode.limitErr,data:resData,msg:codeMapMsg[resCode.limitErr]});
      }
      if(!group.groupName.includes(username)) {
        return res.json({code:resCode.limitErr,data:resData,msg:codeMapMsg[resCode.limitErr]});
      }
      pool.query('update groupRelationship set isShow=0 where groupId=? and username=?',[group.groupId,username],(err)=>{
        if(err) {
          console.log(err);
          return res.json({code:resCode.serverErr,data:resData,msg:codeMapMsg[resCode.serverErr]});
        }
        return res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
      });
    });
  }else {
    return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
  }
  
});

//删除消息
userRouter.get('/delMsg',(req,res:{json:(param:Res<any>)=>void})=>{
  const resData:any =  {result:[]} as any;
  const {msgId,groupId} = req.query;
  const token = req.headers.authorization;
  if(token){
    jwt.verify(token,privateKey,(err:any, decoded:any)=>{
      if(err) {
        return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
      }
      const {username} = decoded;
      pool.query('select isShowMsg from groupRelationship where username =? and groupId=?',[username,groupId],(err,data)=>{
        if(err) {
          console.log(err);
          return res.json({code:resCode.serverErr,data:resData,msg:codeMapMsg[resCode.serverErr]});
        }
        resData.groupId = groupId;
        resData.msgId = msgId;
        const temp  =  JSON.parse(data[0].isShowMsg);
        temp.includes(msgId)?null:temp.push(msgId);
        pool.query('update groupRelationship set isShowMsg =? where username =? and groupId=?',[JSON.stringify(temp),username,groupId],(err)=>{
          if(err) {
            console.log(err);
            return res.json({code:resCode.serverErr,data:resData,msg:codeMapMsg[resCode.serverErr]});
          }
          return res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
        });
      });
    });
  }else {
    return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
  }
});

//添加表情包
userRouter.post('/addMeme',(req,res:{json:(param:Res<any>)=>void})=>{
  const resData:any =  {result:[]} as any;
  const {memeUrl} = req.body;
  const token = req.headers.authorization;
  if(token){
    jwt.verify(token,privateKey,(err:any, decoded:any)=>{
      if(err) {
        return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
      }
      const {username} = decoded;
      pool.query('insert into meme set username=?,memeUrl=?',[username,memeUrl],(err,data)=>{
        if(err) {
          console.log(err);
          return res.json({code:resCode.serverErr,data:resData,msg:codeMapMsg[resCode.serverErr]});
        }
        resData.memeUrl = memeUrl;
        resData.id = data.insertId;
        return res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
      });
    });
  }else {
    return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
  }
});
//获取表情包
userRouter.get('/getMeme',(req,res:{json:(param:Res<any>)=>void})=>{
  const resData:any =  {result:[]} as any;
  const token = req.headers.authorization;
  if(token){
    jwt.verify(token,privateKey,(err:any, decoded:any)=>{
      if(err) {
        return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
      }
      const {username} = decoded;
      pool.query('select * from meme where username=?',[username],(err,data)=>{
        if(err) {
          console.log(err);
          return res.json({code:resCode.serverErr,data:resData,msg:codeMapMsg[resCode.serverErr]});
        }
        resData.result = data;
        return res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
      });
    });
  }else {
    return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
  }
});
//删除表情包
userRouter.delete('/delMeme/:id',(req,res:{json:(param:Res<any>)=>void})=>{
  const resData:any =  {result:[]} as any;
  const {id} = req.params;
  const token = req.headers.authorization;
  if(token){
    jwt.verify(token,privateKey,(err:any, decoded:any)=>{
      if(err) {
        return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
      }
      const {username} = decoded;
      pool.query('delete from meme where username=? and id=?',[username,id],(err)=>{
        if(err) {
          console.log(err);
          return res.json({code:resCode.serverErr,data:resData,msg:codeMapMsg[resCode.serverErr]});
        }
        return res.json({code:resCode.success,data:resData,msg:codeMapMsg[resCode.success]});
      });
    });
  }else {
    return res.json({code:resCode.tokenErr,data:resData,msg:codeMapMsg[resCode.tokenErr]});
  }
});


// **** Export default **** //

export default userRouter;
