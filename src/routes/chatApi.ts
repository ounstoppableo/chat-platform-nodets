import { io } from '@src/upgradeServer';
import {redisClient} from '@src/redis/connect';
import path, { resolve } from 'path';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import pool from '@src/mysql/pool';
import dayjs from 'dayjs';
import { validateInput } from '@src/util/validateInput';
import { v4 as uuidv4 } from 'uuid';
import GLOBALVAR from '@src/globalVar';
import { ServerToUserMsg, userToServerMsg } from './types/chatApi/chatApi';
import {RedisErr} from './types/err';
import custom from '@src/util/log';
import getClientIp from '@src/util/getIp';
import IP2Region from 'ip2region';

const privateKey = fs.readFileSync(path.resolve(__dirname,'../../key/tokenKey.key'));
const regionQuery = new IP2Region();

const groupMsgQueneChannelName = 'groupMsg:msgQuene:';
redisClient.then(redisClient=>{
  async function redisMsgToMysql(upperLimit?:number){
    //传入上限值时，如果GLOBALVAR.MSG_COUNTS不是upperLimit的倍数则不执行
    if(upperLimit && GLOBALVAR.MSG_COUNTS % upperLimit!==0) return; 
    const groupInfos = await redisClient.hVals('groupInfo');
    groupInfos.forEach(groupInfoRow=>{
      const groupInfo = JSON.parse(groupInfoRow);
      pool.query('update groups set time=?,lastMsgUser=?,lastMsg=? where groupId=?',[dayjs(groupInfo.time).format('YYYY-MM-DD HH:mm:ss'),groupInfo.lastMsgUser||'',groupInfo.lastMsg||'',groupInfo.groupId],(err)=>{
        if(err) {
          custom.log(err);
        }
      });
    });
    const userInfos = await redisClient.hVals('userInfo');
    userInfos.forEach(userInfoRow=>{
      const userInfo = JSON.parse(userInfoRow);
      pool.query('update users set region=? where username=?',[userInfo.region,userInfo.username],(err)=>{
        if(err) {
          custom.log(err);
        }
      });
    });
    const keys = await redisClient.keys('groupMsg:*');
    if(keys.length === 0 ) return;
    const promises:Promise<any>[] =[];
    keys.forEach(key=>{
      promises.push(redisClient.hGetAll(key));
    });
    promises.push(redisClient.del(keys));
    Promise.all(promises).then(res=>{
      const msgs = res.slice(0,res.length-1).map((item:any):any=>Object.values(item)).flat(Infinity).map((item:any):any=>{
        const temp =JSON.parse(item);
        const res =  {
          groupId: temp.room,
          text: temp.msg,
          time: dayjs(temp.time).format('YYYY-MM-DD HH:mm:ss'),
          timestamp: JSON.stringify(temp.timestamp),
          avatar: temp.avatar,
          atMembers: JSON.stringify(temp.atMembers),
          username:temp.username,
          id:temp.id,
          likes:temp.likes,
          dislikes:temp.dislikes,
          forMsg:temp.forMsg || '',
          type:temp.type || 'default',
          src:temp.src || '',
          fileName:temp.fileName || '',
          fileSize:temp.fileSize || '',
        };  
        return res;
      });
      msgs.sort((a,b)=>a.id-b.id);
      let sql = 'INSERT INTO gmessage (groupId,text,time,timestamp,avatar,atMembers,username,id,likes,dislikes,forMsg,type,src,fileName,fileSize) VALUES ';
      msgs.forEach((msg:any,index:number)=>{
        sql += `('${msg.groupId}','${msg.text}','${msg.time}','${msg.timestamp}','${msg.avatar}','${msg.atMembers}','${msg.username}',${msg.id},${msg.likes},${msg.dislikes},${msg.forMsg||'\'\''},'${msg.type}','${msg.src}','${msg.fileName}','${msg.fileSize}')`;
        index===msgs.length-1 ? sql+=';':sql+=',';
      });
      pool.query(sql,(err)=>{
        if(err){
          custom.log(err);
        }
      }); 
    });
  }
  //守护进程
  //3点将redis的msg消息转入mysql
  setInterval(()=>{
    if(new Date().getHours() !==3) return; 
    redisMsgToMysql();
  },60*60*1000);
  // 订阅频道
  const pubSubClient = redisClient.duplicate();
  //消息队列
  Promise.all([pubSubClient.subscribe(groupMsgQueneChannelName,async (message:any) => {
    const temp:ServerToUserMsg = JSON.parse(message);
    const resMsg:ServerToUserMsg = {
      room: temp.room,
      msg: temp.msg,
      time: temp.time,
      timestamp: dayjs(temp.time).unix(),
      avatar: temp.avatar,
      atMembers: temp.atMembers || [],
      username:temp.username,
      id:GLOBALVAR.MSG_COUNTS,
      likes:0,
      dislikes:0,
      forMsg:temp.forMsg || '',
      type:temp.type || 'default',
      src:temp.src || '',
      fileName:temp.fileName || '',
      fileSize:temp.fileSize || '',
      region: temp.region,
    };
    try{
      const groupInfoRow = await redisClient.hGet('groupInfo',resMsg.room);
      if(groupInfoRow){
        const groupInfo = JSON.parse(groupInfoRow);
        groupInfo.lastMsg = resMsg.msg;
        groupInfo.time = dayjs(resMsg.time).format('YYYY-MM-DD HH:mm:ss');
        groupInfo.lastMsgUser = resMsg.username;
        redisClient.hSet('groupInfo',resMsg.room,JSON.stringify(groupInfo));
      }
      const userInfoRow = await redisClient.hGet('userInfo',resMsg.username);
      if(userInfoRow){
        const userInfo = JSON.parse(userInfoRow);
        userInfo.region = resMsg.region;
        redisClient.hSet('userInfo',resMsg.username,JSON.stringify(userInfo));
      }
      redisClient.hSet('groupMsg:'+resMsg.room,resMsg.id+'',JSON.stringify(resMsg));
      io.to(resMsg.room).emit('toRoomClient',resMsg);
    }catch(e){
      custom.log(e);
      io.sockets.sockets.forEach(item=>{
        if(item.data.username === resMsg.username){
          item.emit('clientError',{msg:'操作失败，请稍后重试'});
        }
      });
    }
    redisClient.set('msg_count',GLOBALVAR.MSG_COUNTS+1);
    GLOBALVAR.MSG_COUNTS++;
  }),pubSubClient.connect()]).then(()=>{
  //token校验
    io.use((socket, next) => {
    // 从连接中获取 token
      const token = socket.handshake.auth.token;
      // 验证 token
      if(token){
        jwt.verify(token, privateKey, (err:any, decoded:any) => {
          if (err) {
            return next();
          }
          // 将用户信息添加到 socket 对象
          socket.data.username = decoded.username;
          // 继续连接
          next();
        });
      }else {
        return next();
      }
    });
    io.on('error',(err)=>{
      custom.log(err);
    });
  
    io.on('connection',(socket)=>{
    //更新登录状态
      if(socket.data.username) {
        pool.query('update users set isOnline = ? where username = ?',[1,socket.data.username],(err,data)=>{
          if(err) {
            socket.emit('clientError',{msg:'操作失败，请稍后重试'});
            return custom.log(err);
          }
          io.emit('someoneStatusChange',{username:socket.data.username,isOnline:true});
        });
      }
      //加入群聊
      socket.on('joinRoom',(groupIds)=>{
        if(!socket.data.username){
          socket.join('1');
        }else {
          pool.query('select username,region,avatar,isOnline,uid from users where username = ?',[socket.data.username],(err,data)=>{
            if(err) {
              socket.emit('clientError',{msg:'操作失败，请稍后重试'});
              return custom.log(err);
            }
            if(groupIds instanceof Array&&groupIds.length!==0){
              groupIds.forEach((item:any)=>{
                if(socket.data.groups&&socket.data.groups.includes(item.groupId)) {
                  return;
                }
                socket.data.groups?socket.data.groups.push(item.groupId):socket.data.groups=[item.groupId];
                socket.join(item.groupId);
                io.to(item.groupId).emit('joinRoom',{groupId:item.groupId as string,userInfo:data[0]});
              });
            }else {
              if(socket.data.groups&&socket.data.groups.includes(groupIds)) {
                return;
              }
              socket.data.groups?socket.data.groups.push(groupIds):socket.data.groups=[groupIds];
              socket.join(groupIds);
              io.to(groupIds).emit('addGroup',{groupId:groupIds as string,userInfo:data[0]});
            }
          });
  
        }
   
      });
      //接收客户端的消息(群聊天)
      socket.on('msgToServer',(msg)=>{
        if(socket.data.username){
          msg.msg = validateInput(msg.msg);
          msg.atMembers = msg.atMembers?.map(item=>msg.msg.includes('@'+item+' ')?item:'').filter(item=>item!=='');
          const ip = getClientIp(socket.handshake);
          custom.log(socket.handshake);
          const region = regionQuery.search(ip as string)?.province.split('省')[0] || '未知';
          redisClient.publish(groupMsgQueneChannelName,JSON.stringify(Object.assign(msg,{username:socket.data.username,region:region})));
        }else {
          socket.emit('clientError',{msg:'请登录后再发言！'});
        }
  
  
      });
      //喜欢某消息
      socket.on('likeSbMsg',(msg)=>{
        redisClient.hGet('groupMsg:'+msg.room,msg.msgId+'').then((res:any)=>{
          if(!res) throw RedisErr.noFindErr;
          const newMsg = JSON.parse(res);
          newMsg.likes++;
          redisClient.hSet('groupMsg:'+msg.room,msg.msgId+'',JSON.stringify(newMsg));
          io.to(msg.room).emit('sbLikeMsg',{success:true,likes:msg.likes+1,msgId:msg.msgId,room:msg.room,type:'like'});
        }).catch(err=>{
          if(err!==RedisErr.noFindErr){
            custom.log(err);
            return socket.emit('clientError',{msg:'操作失败，请稍后重试'});
          }
          pool.query('update gmessage set likes = ? where id=?',[msg.likes+1,msg.msgId],(err,data)=>{
            if(err) {
              socket.emit('clientError',{msg:'操作失败，请稍后重试'});
              return  custom.log(err);
            }
            io.to(msg.room).emit('sbLikeMsg',{success:true,likes:msg.likes+1,msgId:msg.msgId,room:msg.room,type:'like'});
          });
        });
      });
      //取消点赞
      socket.on('cancelLikeSbMsg',(msg)=>{
        redisClient.hGet('groupMsg:'+msg.room,msg.msgId+'').then((res:any)=>{
          if(!res) throw RedisErr.noFindErr;
          const newMsg = JSON.parse(res);
          newMsg.likes--;
          redisClient.hSet('groupMsg:'+msg.room,msg.msgId+'',JSON.stringify(newMsg));
          io.to(msg.room).emit('cancelSbLikeMsg',{success:true,likes:msg.likes-1,msgId:msg.msgId,room:msg.room,type:'cancelLike'});
        }).catch(err=>{
          if(err!==RedisErr.noFindErr){
            custom.log(err);
            return socket.emit('clientError',{msg:'操作失败，请稍后重试'});
          }
          pool.query('update gmessage set likes = ? where id=?',[msg.likes-1,msg.msgId],(err,data)=>{
            if(err) {
              socket.emit('clientError',{msg:'操作失败，请稍后重试'});
              return  custom.log(err);
            }
            io.to(msg.room).emit('cancelSbLikeMsg',{success:true,likes:msg.likes-1,msgId:msg.msgId,room:msg.room,type:'cancelLike'});
          });
        });
      });
  
      //不喜欢某消息
      socket.on('dislikeSbMsg',(msg)=>{
        redisClient.hGet('groupMsg:'+msg.room,msg.msgId+'').then((res:any)=>{
          if(!res) throw RedisErr.noFindErr;
          const newMsg = JSON.parse(res);
          newMsg.dislikes++;
          redisClient.hSet('groupMsg:'+msg.room,msg.msgId+'',JSON.stringify(newMsg));
          io.to(msg.room).emit('sbDislikeMsg',{success:true,dislikes:msg.dislikes+1,msgId:msg.msgId,room:msg.room});
        }).catch(err=>{
          if(err!==RedisErr.noFindErr){
            custom.log(err);
            return socket.emit('clientError',{msg:'操作失败，请稍后重试'});
          }
          pool.query('update gmessage set dislikes = ? where id=?',[msg.dislikes+1,msg.msgId],(err,data)=>{
            if(err) {
              socket.emit('clientError',{msg:'操作失败，请稍后重试'});
              return  custom.log(err);
            }
            io.to(msg.room).emit('sbDislikeMsg',{success:true,dislikes:msg.dislikes+1,msgId:msg.msgId,room:msg.room});
          });
        });
      });
      //取消不喜欢
      socket.on('cancelDislikeSbMsg',(msg)=>{
        redisClient.hGet('groupMsg:'+msg.room,msg.msgId+'').then((res:any)=>{
          if(!res) throw RedisErr.noFindErr;
          const newMsg = JSON.parse(res);
          newMsg.dislikes--;
          redisClient.hSet('groupMsg:'+msg.room,msg.msgId+'',JSON.stringify(newMsg));
          io.to(msg.room).emit('cancelSbDislikeMsg',{success:true,dislikes:msg.dislikes-1,msgId:msg.msgId,room:msg.room});
        }).catch(err=>{
          if(err!==RedisErr.noFindErr){
            custom.log(err);
            return socket.emit('clientError',{msg:'操作失败，请稍后重试'});
          }
          pool.query('update gmessage set dislikes = ? where id=?',[msg.dislikes-1,msg.msgId],(err,data)=>{
            if(err) {
              socket.emit('clientError',{msg:'操作失败，请稍后重试'});
              return  custom.log(err);
            }
            io.to(msg.room).emit('cancelSbDislikeMsg',{success:true,dislikes:msg.dislikes-1,msgId:msg.msgId,room:msg.room});
          });
        });
      });
  
      //p2p聊天
      socket.on('p2pChat',(msg)=>{
        if(socket.data.username){
          msg.msg = validateInput(msg.msg);
          new Promise((resolve:(data:{
          groupName: any,
          groupId: any,
          username: any,
          gavatar: any,
          lastMsg: any,
          time: any,
          lastMsgUser: any,
          type: 'p2p',
          fromAvatar: any,
          toAvatar: any,
          toUsername: any,
          authorBy:any,
        }
      )=>any,reject)=>{
            //看有没有群，没有就创建一个
            redisClient.hGet('groupInfo', msg.room).then((res:any)=>{
              const groupInfo = JSON.parse(res);
              if(!res) throw RedisErr.noFindErr;
              pool.query('update groupRelationship set isShow=1 where groupId=? and username=? or groupId=? and username=?',[groupInfo.groupId,msg.fromName,groupInfo.groupId,msg.toName],(err)=>{
                if(err){
                  reject('操作失败，请稍后重试!');
                  return custom.log(err);
                }
                redisClient.hGet('groupsForUser:'+msg.fromName,msg.room).then((data)=>{
                  if(data){
                    const temp = JSON.parse(data);
                    temp.isShow = 1;
                    redisClient.hSet('groupsForUser:'+msg.fromName, msg.room ,JSON.stringify(temp));
                  }
                });
                redisClient.hGet('groupsForUser:'+msg.toName,msg.room).then((data)=>{
                  if(data){
                    const temp = JSON.parse(data);
                    temp.isShow = 1;
                    redisClient.hSet('groupsForUser:'+msg.toName, msg.room ,JSON.stringify(temp));
                  }
                });
                resolve(groupInfo);
              });
            }).catch(err=>{
              if(err!==RedisErr.noFindErr) {
                custom.log(err);
                return reject('操作失败，请稍后重试!');
              }
              pool.query('select *,username as authorBy from groups where groupName=? or groupName=?',[msg.fromName+'&&&'+msg.toName,msg.toName+'&&&'+msg.fromName],(err,data)=>{
                if(err){
                  reject('操作失败，请稍后重试!');
                  return custom.log(err);
                }
                if(data.length!==0){
                  pool.query('update groupRelationship set isShow=1 where groupId=? and username=? or groupId=? and username=?',[data[0].groupId,msg.fromName,data[0].groupId,msg.toName],(err)=>{
                    if(err){
                      reject('操作失败，请稍后重试!');
                      return custom.log(err);
                    }
                    resolve(data[0]);
                  });
                }else{
                  const groupId = uuidv4();
                  pool.getConnection((err,connection)=>{
                    if(err) {
                      reject('操作失败，请稍后重试');
                      return  custom.log(err);
                    }
                    connection.beginTransaction((err)=>{
                      if(err) {
                        reject('操作失败，请稍后重试');
                        connection.release();
                        return  custom.log(err);
                      }
                      connection.query('insert into groups set groupName=?,groupId=?,username=?,fromAvatar=?,toAvatar=?,toUsername=?,type=\'p2p\',time=?',[msg.fromName+'&&&'+msg.toName,groupId,msg.fromName,msg.fromAvatar,msg.toAvatar,msg.toName,dayjs(new Date()).format('YYYY-MM-DD HH:mm:ss')],(err,data)=>{
                        if(err) {
                          return  connection.rollback(() => {
                            reject('操作失败，请稍后重试');
                            connection.release(); // 释放连接回连接池
                            custom.log(err);
                          });
                        }
                        connection.query('insert into groupRelationship (groupId,username) values (?,?),(?,?)',[groupId,msg.fromName,groupId,msg.toName],(err)=>{
                          if(err) {
                            return  connection.rollback(() => {
                              reject('操作失败，请稍后重试');
                              connection.release(); // 释放连接回连接池
                              custom.log(err);
                            });
                          }
                          connection.query('update relationship set groupId=?,groupName=? where username=? and friendName=? or username=? and friendName=?',[groupId,msg.fromName+'&&&'+msg.toName,msg.fromName,msg.toName,msg.toName,msg.fromName],(err)=>{
                            if(err) {
                              return  connection.rollback(() => {
                                reject('操作失败，请稍后重试');
                                connection.release(); // 释放连接回连接池
                                custom.log(err);
                              });
                            }
                            connection.commit((commitError)=>{
                              if (commitError) {
                                return connection.rollback(() => {
                                  reject('操作失败，请稍后重试');
                                  connection.release(); // 释放连接回连接池
                                  console.error('Error committing transaction:', commitError);
                                });
                              }
                              // 释放连接回连接池
                              connection.release();
                              const groupInfo = {        
                                groupName: msg.fromName+'&&&'+msg.toName,
                                groupId: groupId,
                                username: msg.fromName,
                                gavatar: null,
                                lastMsg: null,
                                time: dayjs(new Date()).format('YYYY-MM-DD HH:mm:ss'),
                                lastMsgUser: null,
                                type: 'p2p',
                                fromAvatar: msg.fromAvatar,
                                toAvatar: msg.toAvatar,
                                toUsername: msg.toName,
                                authorBy: msg.fromName,
                              };
                              redisClient.exists('groupsForUser:'+msg.fromName).then((isExist)=>{
                                if(isExist===1){
                                  redisClient.hSet('groupsForUser:'+msg.fromName, groupId ,JSON.stringify({isShowMsg:JSON.stringify([]),username:msg.fromName,groupId,isShow:1}));
                                }
                              });
                              redisClient.exists('groupsForUser:'+msg.toName).then((isExist)=>{
                                if(isExist===1){
                                  redisClient.hSet('groupsForUser:'+msg.toName, groupId,JSON.stringify({isShowMsg:JSON.stringify([]),username:msg.toName,groupId,isShow:1}));
                                }
                              });
                              redisClient.hSet('groupInfo',groupId,JSON.stringify(groupInfo));
                              resolve(groupInfo as any);
                            });
                          });
                        });
                      });
                    });
                  });
                }
              });
            });
          }).then((res:any)=>{
            io.sockets.sockets.forEach((item:any)=>{
              if(item.data.username===res.username||item.data.username===res.toUsername){ 
                item.join(res.groupId);
                item.data.groups?item.data.groups.push(res.groupId):item.data.groups=[res.groupId];
                item.emit('addGroup',{groupId:res.groupId,groupInfo:res});
              }
            });
            const ip = getClientIp(socket.handshake);
            const region = regionQuery.search(ip as string)?.province.split('省')[0] || '未知';
            redisClient.publish(groupMsgQueneChannelName,JSON.stringify(Object.assign(msg,{username:socket.data.username,room:res.groupId,avatar:msg.fromAvatar,region:region})));
          },(err)=>{
            socket.emit('clientError',{msg:err});
          });
        }else {
          socket.emit('clientError',{msg:'请登录后再发言！'});
        }
      });
  
      //删除群聊
      socket.on('delGroup',(msg)=>{
        if(socket.data.username){
          if(msg.authorBy===socket.data.username){
            pool.query('select username from groupRelationship where groupId=?',[msg.groupId],(err,users)=>{
              if(err) {
                socket.emit('clientError',{msg:'服务器错误，请重试!'});
                return custom.log(err);
              }
              pool.query('DELETE FROM groups WHERE groupId=?',[msg.groupId],(err,data)=>{
                if(err) {
                  socket.emit('clientError',{msg:'服务器错误，请重试!'});
                  return custom.log(err);
                }
                redisClient.hDel('groupInfo',msg.groupId);
                io.to(msg.groupId).emit('delGroup',{success:true,groupInfo:msg});
              });
              users.forEach((user:any)=>{
                redisClient.hDel('groupsForUser:'+user.username,msg.groupId);
              });
              if(users.length===1) return;
              let delGroupSystemInsertSql = 'INSERT INTO systemMsg (done,hadRead,type,fromName,toName,groupName,groupId) VALUES ';
              for(let i=0;i<users.length;i++){
                if(users[i].username===msg.authorBy) continue;
                delGroupSystemInsertSql += `('success',0,'delGroup','${msg.authorBy}','${users[i].username}','${msg.groupName}','${msg.groupId}')`;
                i===users.length-1?'':delGroupSystemInsertSql+=',';
              }
              pool.query(delGroupSystemInsertSql,(err,data)=>{
                if(err) {
                  socket.emit('clientError',{msg:'服务器错误，请重试!'});
                  return custom.log(err);
                }
                const  userMapMsgId = {} as any;
                let msgId = data.insertId;
                for(let i=0;i<users.length;i++){
                  if(users[i].username===msg.authorBy) continue;
                  userMapMsgId[users[i].username] = msgId;
                  msgId++;
                }
                io.sockets.sockets.forEach(item=>{
                  if(users.find((user:any)=>item.data.username===user.username&&user.username!==msg.authorBy)) {
                    item.emit('delGroup',{
                      systemMsg:{
                        done:'success',hadRead:false,type:'delGroup',fromName:msg.authorBy,toName:item.data.username,groupName:msg.groupName,groupId:msg.groupId,msgId:userMapMsgId[item.data.username],
                      },
                    });
                  }
                });
              });
            });
          }else {
            socket.emit('clientError',{msg:'权限不够!'});
          }
        }else {
          socket.emit('clientError',{msg:'权限不够'});
        }
      });
      //退出群聊
      socket.on('exitGroup',(msg)=>{
        if(socket.data.username){
          pool.query('DELETE FROM groupRelationship WHERE groupId=? and username=?',[msg.groupId,socket.data.username],(err,data)=>{
            if(err) {
              socket.emit('clientError',{msg:'服务器错误，请重试!'});
              return custom.log(err);
            }
            redisClient.exists('groupsForUser:'+socket.data.username).then((isExist)=>{
              if(isExist===1){
                redisClient.hDel('groupsForUser:'+socket.data.username, msg.groupId);
              }
            });
            io.to(msg.groupId).emit('exitGroup',{success:true,groupInfo:msg,username:socket.data.username});
          });
          pool.query('insert into systemMsg set done=\'success\',hadRead=0,type=\'exitGroup\',fromName=?,toName=?,groupName=?,groupId=?',[socket.data.username,msg.authorBy,msg.groupName,msg.groupId],(err,data)=>{
            if(err) {
              socket.emit('clientError',{msg:'服务器错误，请重试!'});
              return custom.log(err);
            }
            io.sockets.sockets.forEach((item:any)=>{
              if(item.data.username===msg.authorBy){
                item.emit('exitGroup',{
                  systemMsg:{
                    done:'success',
                    hadRead:0,
                    type:'exitGroup',
                    fromName:socket.data.username,
                    toName:msg.authorBy,
                    groupName:msg.groupName,
                    groupId:msg.groupId,
                    msgId:data.insertId,
                  },
                });
              }
            });
          });
        }else {
          socket.emit('clientError',{msg:'权限不够'});
        }
      });
      //修改群名
      socket.on('editGroupName',(msg)=>{
        if(socket.data.username){
          if(msg.group.authorBy===socket.data.username){
            pool.query('update groups set groupName=? WHERE groupId=?',[msg.newName,msg.group.groupId],(err,data)=>{
              if(err) {
                socket.emit('clientError',{msg:'服务器错误，请重试!'});
                return custom.log(err);
              }
              redisClient.hGet('groupInfo',msg.group.groupId).then(groupInfoRow=>{
                if(groupInfoRow){
                  const groupInfo = JSON.parse(groupInfoRow);
                  groupInfo.groupName = msg.newName;
                  redisClient.hSet('groupInfo',msg.group.groupId,JSON.stringify(groupInfo));
                }
              });
              io.to(msg.group.groupId).emit('editGroupName',{success:true,groupInfo:msg.group,newName:msg.newName});
            });
          }else {
            socket.emit('clientError',{msg:'权限不够!'});
          }
        }else {
          socket.emit('clientError',{msg:'权限不够'});
        }
      });
      //踢出群聊
      socket.on('kickOutGroup',(msg)=>{
        if(socket.data.username){
          if(msg.group.authorBy===socket.data.username){
            pool.query('DELETE FROM groupRelationship WHERE groupId=? and username=?',[msg.group.groupId,msg.kickOutUsername],(err,data)=>{
              if(err) {
                socket.emit('clientError',{msg:'服务器错误，请重试!'});
                return custom.log(err);
              }
              redisClient.exists('groupsForUser:'+socket.data.username).then((isExist)=>{
                if(isExist===1){
                  redisClient.hDel('groupsForUser:'+socket.data.username, msg.group.groupId);
                }
              });
              io.to(msg.group.groupId).emit('kickOutGroup',{success:true,groupInfo:msg.group,kickOutUsername:msg.kickOutUsername});
            });
            pool.query('insert into systemMsg set done=\'success\',hadRead=0,type=\'kickOutGroup\',fromName=?,toName=?,groupName=?,groupId=?',[socket.data.username,msg.kickOutUsername,msg.group.groupName,msg.group.groupId],(err,data)=>{
              if(err) {
                socket.emit('clientError',{msg:'服务器错误，请重试!'});
                return custom.log(err);
              }
              io.sockets.sockets.forEach((item:any)=>{
                if(item.data.username===msg.kickOutUsername){
                  item.emit('kickOutGroup',{
                    systemMsg:{
                      done:'success',
                      hadRead:0,
                      type:'kickOutGroup',
                      fromName:socket.data.username,
                      toName:msg.kickOutUsername,
                      groupName:msg.group.groupName,
                      groupId:msg.group.groupId,
                      msgId:data.insertId,
                    },
                  });
                }
              });
            });
          }else {
            socket.emit('clientError',{msg:'权限不够!'});
          }
        }else {
          socket.emit('clientError',{msg:'权限不够'});
        }
      });
  
      //撤回消息
      socket.on('withdrawMsg',async (msg)=>{
        if(socket.data.username){
          const groupInfoRow = await redisClient.hGet('groupInfo',msg.room);
          const groupInfo = groupInfoRow && JSON.parse(groupInfoRow);
          if(groupInfo && groupInfo.username === socket.data.username && groupInfo.type==='group'){
            const oldMsgRow = await redisClient.hGet('groupMsg:'+msg.room,msg.id+'');
            if(!oldMsgRow) {
              pool.query('update gmessage set type=\'withdraw\',username=? where id=?',[socket.data.username,msg.id],(err)=>{
                if(err) {
                  custom.log(err);
                  return socket.emit('clientError',{msg:'服务器错误，请重试!'});
                }
                io.to(msg.room).emit('withdrawMsg',Object.assign(msg,{type:'withdraw',username:socket.data.username}));
              });
            }else {
              const oldMsg = JSON.parse(oldMsgRow);
              oldMsg.type = 'withdraw';
              oldMsg.username = socket.data.username;
              await redisClient.hSet('groupMsg:'+msg.room,msg.id+'',JSON.stringify(oldMsg));
              io.to(msg.room).emit('withdrawMsg',Object.assign(msg,{type:'withdraw',username:socket.data.username}));
            }
          }else if(msg.username===socket.data.username){
            const time = Date.now();
            if(time/1000-msg.timestamp>60*2){
              socket.emit('clientError',{msg:'超过2分钟就不能撤回了o~~'});
            }else {
              const oldMsgRow = await redisClient.hGet('groupMsg:'+msg.room,msg.id+'');
              if(!oldMsgRow) return socket.emit('clientError',{msg:'超过2分钟就不能撤回了o~~'});
              const oldMsg = JSON.parse(oldMsgRow);
              oldMsg.type = 'withdraw';
              await redisClient.hSet('groupMsg:'+msg.room,msg.id+'',JSON.stringify(oldMsg));
              io.to(msg.room).emit('withdrawMsg',Object.assign(msg,{type:'withdraw'}));
            }
          }else {
            socket.emit('clientError',{msg:'权限不够!'});
          }
        }else {
          socket.emit('clientError',{msg:'权限不够'});
        }
      });
  
      //添加好友
      socket.on('addFriend',(msg)=>{
        if(socket.data.username){
          const {targetUsername} = msg;
          const resData:any =  {} as any;
          const username = socket.data.username;
          pool.query('select * from systemMsg where fromName=? and toName=? and type=\'addFriend\' and done=\'padding\' or fromName=? and toName=? and type=\'addFriend\' and done=\'padding\'',[username,targetUsername,targetUsername,username],(err,data)=>{
            if(err) {
              socket.emit('clientError',{msg:'服务器错误，请重试!'});
              return custom.log(err);
            }
            if(data.length!==0){
              resData.type = 0;
              if(data[0].fromName===username){
                resData.msg = '正在等待确认！请不要多次请求';
              }else {
                resData.msg = '对方已经发送好友请求，请在系统消息内确认！';
              }
              return socket.emit('addFriend',resData);
            }
            pool.query('select * from relationship where username=? and friendName=? or username=? and friendName=?',[username,targetUsername,targetUsername,username],(err,data)=>{
              if(err) {
                socket.emit('clientError',{msg:'服务器错误，请重试!'});
                return custom.log(err);
              }
              if(data.length!==0){
                resData.type = 0;
                resData.msg = '你们已经是好友啦!不要重复添加~~';
                return socket.emit('addFriend',resData);
              }
              pool.query('INSERT INTO systemMsg (fromName, toName, type) VALUES (?, ?, "addFriend")',[username,targetUsername],(err,data)=>{
                if(err) {
                  socket.emit('clientError',{msg:'服务器错误，请重试!'});
                  return custom.log(err);
                }
                resData.type = 1;
                resData.msg = '请求发送成功！';
                io.sockets.sockets.forEach(item=>{
                  if(item.data.username===targetUsername){
                    const foTagetUserdata = {
                      fromName:username, 
                      toName:targetUsername, 
                      type:'addFriend',
                      msgId: data.insertId,
                      done: 'padding',
                      hadRead: 0,
                      groupName: null,
                      groupId: null,
                    };
                    item.emit('addFriend',{data:foTagetUserdata});
                  }
                });
                return socket.emit('addFriend',resData);
              });
            });
          });
        }else {
          socket.emit('clientError',{msg:'权限不够'});
        }
      });
      //同意添加
      socket.on('acceptAddFriend',(msg)=>{
        if(socket.data.username){
          const {msgId,fromName,toName} = msg;
          if(socket.data.username===toName){
            const resData = {} as any;
            pool.query('select * from relationship where username=? and friendName=? or username=? and friendName=?',[fromName,toName,toName,fromName],(err,data)=>{
              if(err) {
                custom.log(err);
                return socket.emit('clientError',{msg:'服务器错误，请重试!'});
              }
              if(data.length!==0) return socket.emit('clientError',{msg:'不要重复操作！'});
              new Promise((resolve,reject)=>{
                pool.getConnection((err,connection)=>{
                  if(err) {
                    return reject(err);
                  }
                  connection.beginTransaction((err)=>{
                    if (err) {
                      connection.release(); // 释放连接回连接池
                      return reject(err);
                    }
                    connection.query('insert into relationship set username=?,friendName=?',[fromName,toName],(err,data)=>{
                      if (err) {
                        return connection.rollback(() => {
                          connection.release(); // 释放连接回连接池
                          reject(err);
                        });
                      }
                      connection.query('update systemMsg set done=\'success\' where msgId=?',[msgId],(err,data)=>{
                        if(err) {
                          return connection.rollback(() => {
                            connection.release(); // 释放连接回连接池
                            reject(err);
                          });
                        }
                        connection.commit((commitError) => {
                          if (commitError) {
                            return connection.rollback(() => {
                              connection.release(); // 释放连接回连接池
                              reject(err);
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
                resData.msgId = msgId;
                resData.toName = toName;
                resData.fromName = fromName;
                io.sockets.sockets.forEach(item=>{
                  if(item.data.username===fromName){
                    item.emit('acceptAddFriend',resData);
                  }
                });
                return socket.emit('acceptAddFriend',resData);
              }).catch((err)=>{
                console.error('Error committing transaction:', err);
                return socket.emit('clientError',{msg:'服务器错误，请重试!'});
              });
            });
          }else {
            socket.emit('clientError',{msg:'权限不够'});
          }
        }else {
          socket.emit('clientError',{msg:'权限不够'});
        }
  
      });
      //拒绝添加好友
      socket.on('rejectAddFriend',(msg)=>{
        if(socket.data.username){
          const {msgId,fromName,toName} = msg;
          if(socket.data.username===toName){
            pool.query('update systemMsg set done=\'failed\',hadRead=0 where msgId=?',[msgId],(err,data)=>{
              if(err){
                custom.log(err);
                return socket.emit('clientError',{msg:'服务器错误，请重试!'});
              }
              io.sockets.sockets.forEach(item=>{
                if(item.data.username===fromName){
                  const toFromUserData = {
                    msgId,fromName,toName,done:'failed',hadRead:0,type:'addFriend',
                  };
                  item.emit('rejectAddFriend',{data:toFromUserData});
                }
              });
              return socket.emit('rejectAddFriend',{msgId,fromName,toName});
            });
          }else {
            socket.emit('clientError',{msg:'权限不够'});
          }
        }else {
          socket.emit('clientError',{msg:'权限不够'});
        }
      });
  
      //添加群成员
      socket.on('addGroupMember',(msg)=>{
        if(socket.data.username){
          const {groupId,groupName,targetsUsernames,authorBy} = msg;
          const {username} = socket.data;
          const resData = {} as any;
          if(username===authorBy){
            const promises = targetsUsernames.map((toName:string)=>{
              return new Promise((resolve,reject)=>{
                pool.query('select * from systemMsg where fromName=? and toName=? and done="padding" and type="addGroupMember" and groupId=?',[username,toName,groupId],(err,data)=>{
                  if(err){
                    return reject(err);
                  }
                  if(data.length!==0) return resolve(data[0]);
                  pool.query('insert into systemMsg set fromName=?,toName=?,type="addGroupMember",done="padding",groupName=?,groupId=?',[username,toName,groupName,groupId],(err,data)=>{
                    if(err){
                      return reject(err);
                    }
                    resolve(data);
                  });
                });
              });
            });
            Promise.all(promises).then((res:any)=>{
              io.sockets.sockets.forEach(item=>{
                if(targetsUsernames.includes(item.data.username)){
                  const info = res[targetsUsernames.findIndex(name=>name===item.data.username)];
                  item.emit('addGroupMember',{
                    data: {fromName:username,toName:item.data.username,type:'addGroupMember',done:'padding',groupName:groupName,groupId:groupId,msgId:info.msgId||info.insertId,hadRead:false},
                  });
                }
              });
              socket.emit('addGroupMember',resData);
            },(err)=>{
              custom.log(err);
              return socket.emit('clientError',{msg:'服务器错误，请重试!'});
            });
          }else{
            socket.emit('clientError',{msg:'权限不够'});
          }
        }else{
          socket.emit('clientError',{msg:'权限不够'});
        }
      });
      //拒绝加群
      socket.on('rejectJoinGroup',(msg)=>{
        if(socket.data.username){
          const {systemMsg} = msg;
          if(systemMsg.toName===socket.data.username){
            pool.query('update systemMsg set done=\'failed\',hadRead=0 where msgId=?',[systemMsg.msgId],(err,data)=>{
              if(err) {
                custom.log(err);
                return socket.emit('clientError',{msg:'服务器错误，请重试!'});
              }
              io.sockets.sockets.forEach(item=>{
                if(item.data.username===systemMsg.fromName){
                  item.emit('rejectJoinGroup',{systemMsg:{...systemMsg,done:'failed'}});
                }
              });
              return socket.emit('rejectJoinGroup',{systemMsg:{...systemMsg,done:'failed'}});
            });
          }else {
            socket.emit('clientError',{msg:'权限不够!'});
          }
        }else {
          socket.emit('clientError',{msg:'权限不够'});
        }
      });
  
      //离开
      socket.on('disconnect',(msg)=>{
        if(socket.data.username) {
          pool.query('update users set isOnline = ? where username = ?',[0,socket.data.username],async (err,data)=>{
            if(err) {
              socket.emit('clientError',{msg:'操作失败，请稍后重试'});
              return custom.log(err);
            }
            const userInfoRow = await redisClient.hGet('userInfo',socket.data.username);
            if(userInfoRow) {
              const userInfo = JSON.parse(userInfoRow);
              userInfo.isOnline = false;
              userInfo.isLogin = false;
              redisClient.hSet('userInfo',socket.data.username,JSON.stringify(userInfo));
            }
            io.emit('someoneStatusChange',{username:socket.data.username,isOnline:false});
          });
        }
      });
    });
  });
});


