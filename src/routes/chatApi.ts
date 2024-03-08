import { io } from '@src/upgradeServer';
import redisClient from '@src/redis/connect';
import path, { resolve } from 'path';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import pool from '@src/mysql/pool';
import dayjs from 'dayjs';
import { validateInput } from '@src/util/validateInput';
import { v4 as uuidv4 } from 'uuid';

const privateKey = fs.readFileSync(path.resolve(__dirname,'../../key/tokenKey.key'));

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
  console.log(err);
});

io.on('connection',(socket)=>{
  //更新登录状态
  if(socket.data.username) {
    pool.query('update users set isOnline = ? where username = ?',[1,socket.data.username],(err,data)=>{
      if(err) {
        socket.emit('clientError',{msg:'操作失败，请稍后重试'});
        return console.log(err);
      }
      io.emit('someoneStatusChange',{username:socket.data.username,isOnline:true});
    });
  }
  //加入群聊
  socket.on('joinRoom',(groupIds)=>{
    if(groupIds instanceof Array&&groupIds.length!==0){
      groupIds.forEach((item:any)=>{
        if(socket.data.groups&&socket.data.groups.includes(item.groupId)) {
          return;
        }
        socket.data.groups?socket.data.groups.push(item.groupId):socket.data.groups=[item.groupId];
        socket.join(item.groupId);
      });
    }else {
      pool.query('select username,region,avatar,isOnline,uid from users where username = ?',[socket.data.username],(err,data)=>{
        if(err) {
          socket.emit('clientError',{msg:'操作失败，请稍后重试'});
          return console.log(err);
        }
        io.to(groupIds).emit('addGroup',{groupId:groupIds as string,userInfo:data[0]});
      });
      if(socket.data.groups&&socket.data.groups.includes(groupIds)) {
        return;
      }
      socket.data.groups?socket.data.groups.push(groupIds):socket.data.groups=[groupIds];
      socket.join(groupIds);
    }
  });
  //接收客户端的消息(群聊天)
  socket.on('msgToServer',(msg)=>{
    if(socket.data.username){
      msg.msg = validateInput(msg.msg);
      msg.atMembers = msg.atMembers?.map(item=>msg.msg.includes('@'+item+' ')?item:'').filter(item=>item!=='');
      pool.getConnection((err,connection)=>{
        if(err) {
          socket.emit('clientError',{msg:'操作失败，请稍后重试'});
          return  console.log(err);
        }
        connection.beginTransaction((err)=>{
          if(err) {
            socket.emit('clientError',{msg:'操作失败，请稍后重试'});
            connection.release();
            return  console.log(err);
          }
          connection.query('insert gmessage set username=?,time=?,text=?,timestamp=?,likes=?,dislikes=?,groupId=?,atMembers=?,forMsg=?',[socket.data.username,dayjs(msg.time).format('YYYY-MM-DD HH:mm:ss'),msg.msg,dayjs(msg.time).unix(),0,0,msg.room,JSON.stringify(msg.atMembers),msg.forMsg],(err,data)=>{
            if(err) {
              return  connection.rollback(() => {
                socket.emit('clientError',{msg:'操作失败，请稍后重试'});
                connection.release(); // 释放连接回连接池
                console.log(err);
              });
            }
            connection.query('update groups set lastMsg = ?,time = ?,lastMsgUser = ? where groupId=?',[msg.msg,dayjs(msg.time).format('YYYY-MM-DD HH:mm:ss'),socket.data.username,msg.room],(err)=>{
              if(err) {
                return  connection.rollback(() => {
                  socket.emit('clientError',{msg:'操作失败，请稍后重试'});
                  connection.release(); // 释放连接回连接池
                  console.log(err);
                });
              }
              connection.commit((commitError)=>{
                if (commitError) {
                  return connection.rollback(() => {
                    socket.emit('clientError',{msg:'操作失败，请稍后重试'});
                    connection.release(); // 释放连接回连接池
                    console.error('Error committing transaction:', commitError);
                  });
                }
                // 释放连接回连接池
                connection.release();
                io.to(msg.room).emit('toRoomClient',Object.assign({username:socket.data.username,id:data.insertId,likes:0,dislikes:0,forMsg:msg.forMsg},msg));
              });
            });
          });
        });
      });
    }else {
      socket.emit('clientError',{msg:'请登录后再发言！'});
    }


  });
  //喜欢某消息
  socket.on('likeSbMsg',(msg)=>{
    pool.query('update gmessage set likes = ? where id=?',[msg.likes+1,msg.msgId],(err,data)=>{
      if(err) {
        socket.emit('clientError',{msg:'操作失败，请稍后重试'});
        return  console.log(err);
      }
      io.to(msg.room).emit('sbLikeMsg',{success:true,likes:msg.likes+1,msgId:msg.msgId,room:msg.room,type:'like'});
    });
  });
  //取消点赞
  socket.on('cancelLikeSbMsg',(msg)=>{
    pool.query('update gmessage set likes = ? where id=?',[msg.likes-1,msg.msgId],(err,data)=>{
      if(err) {
        socket.emit('clientError',{msg:'操作失败，请稍后重试'});
        return  console.log(err);
      }
      io.to(msg.room).emit('cancelSbLikeMsg',{success:true,likes:msg.likes-1,msgId:msg.msgId,room:msg.room,type:'cancelLike'});
    });
  });

  //不喜欢某消息
  socket.on('dislikeSbMsg',(msg)=>{
    pool.query('update gmessage set dislikes = ? where id=?',[msg.dislikes+1,msg.msgId],(err,data)=>{
      if(err) {
        socket.emit('clientError',{msg:'操作失败，请稍后重试'});
        return  console.log(err);
      }
      io.to(msg.room).emit('sbDislikeMsg',{success:true,dislikes:msg.dislikes+1,msgId:msg.msgId,room:msg.room});
    });
  });
  //取消不喜欢
  socket.on('cancelDislikeSbMsg',(msg)=>{
    pool.query('update gmessage set dislikes = ? where id=?',[msg.dislikes-1,msg.msgId],(err,data)=>{
      if(err) {
        socket.emit('clientError',{msg:'操作失败，请稍后重试'});
        return  console.log(err);
      }
      io.to(msg.room).emit('cancelSbDislikeMsg',{success:true,dislikes:msg.dislikes-1,msgId:msg.msgId,room:msg.room});
    });
  });

  //p2p聊天
  socket.on('p2pChat',(msg)=>{
    if(socket.data.username){
      msg.msg = validateInput(msg.msg);
      new Promise((resolve:(data:{
        groupName: string,
        groupId: string,
        username: string,
        gavatar: any,
        lastMsg: any,
        time: any,
        lastMsgUser: any,
        type: 'p2p',
        fromAvatar: string,
        toAvatar: string,
        toUsername: string,
        authorBy:string,
      }
    )=>any,reject)=>{
        //看有没有群，没有就创建一个
        pool.query('select *,username as authorBy from groups where groupName=? or groupName=?',[msg.fromName+'&&&'+msg.toName,msg.toName+'&&&'+msg.fromName],(err,data)=>{
          if(err){
            reject('操作失败，请稍后重试!');
            return console.log(err);
          }
          if(data.length!==0){
            pool.query('update groupRelationship set isShow=1 where groupId=? and username=? or groupId=? and username=?',[data[0].groupId,msg.fromName,data[0].groupId,msg.toName],(err)=>{
              if(err){
                reject('操作失败，请稍后重试!');
                return console.log(err);
              }
              resolve(data[0]);
            });
          }else{
            const groupId = uuidv4();
            pool.getConnection((err,connection)=>{
              if(err) {
                reject('操作失败，请稍后重试');
                return  console.log(err);
              }
              connection.beginTransaction((err)=>{
                if(err) {
                  reject('操作失败，请稍后重试');
                  connection.release();
                  return  console.log(err);
                }
                connection.query('insert into groups set groupName=?,groupId=?,username=?,fromAvatar=?,toAvatar=?,toUsername=?,type=\'p2p\'',[msg.fromName+'&&&'+msg.toName,groupId,msg.fromName,msg.fromAvatar,msg.toAvatar,msg.toName],(err,data)=>{
                  if(err) {
                    return  connection.rollback(() => {
                      reject('操作失败，请稍后重试');
                      connection.release(); // 释放连接回连接池
                      console.log(err);
                    });
                  }
                  connection.query('insert into groupRelationship (groupId,username) values (?,?),(?,?)',[groupId,msg.fromName,groupId,msg.toName],(err)=>{
                    if(err) {
                      return  connection.rollback(() => {
                        reject('操作失败，请稍后重试');
                        connection.release(); // 释放连接回连接池
                        console.log(err);
                      });
                    }
                    connection.query('update relationship set groupId=?,groupName=? where username=? and friendName=? or username=? and friendName=?',[groupId,msg.fromName+'&&&'+msg.toName,msg.fromName,msg.toName,msg.toName,msg.fromName],(err)=>{
                      if(err) {
                        return  connection.rollback(() => {
                          reject('操作失败，请稍后重试');
                          connection.release(); // 释放连接回连接池
                          console.log(err);
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
                        resolve({        
                          groupName: msg.fromName+'&&&'+msg.toName,
                          groupId: groupId,
                          username: msg.fromName,
                          gavatar: null,
                          lastMsg: null,
                          time: null,
                          lastMsgUser: null,
                          type: 'p2p',
                          fromAvatar: msg.fromAvatar,
                          toAvatar: msg.toAvatar,
                          toUsername: msg.toName,
                          authorBy: msg.fromName,
                        });
                      });
                    });
                  });
                });
              });
            });
          }
        });
      }).then((res)=>{
        io.sockets.sockets.forEach((item:any)=>{
          if(item.data.username===res.username||item.data.username===res.toUsername){ 
            if(!item.data.groups || !item.data.groups.includes(res.groupId)) {
              item.join(res.groupId);
              item.data.groups?item.data.groups.push(res.groupId):item.data.groups=[res.groupId];
              item.emit('addGroup',{groupId:res.groupId,groupInfo:res});
            }
          }
        });

        new Promise((resolve,reject)=>{
          pool.getConnection((err,connection)=>{
            if(err) {
              reject('操作失败，请稍后重试');
              return  console.log(err);
            }
            connection.beginTransaction((err)=>{
              if(err) {
                reject('操作失败，请稍后重试');
                connection.release();
                return  console.log(err);
              }
              connection.query('insert into gmessage set username=?,time=?,text=?,timestamp=?,groupId=?',[msg.fromName,dayjs(msg.time).format('YYYY-MM-DD HH:mm:ss'),msg.msg,dayjs(msg.time).unix(),res.groupId],(err,data)=>{
                if(err) {
                  return  connection.rollback(() => {
                    reject('操作失败，请稍后重试');
                    connection.release(); // 释放连接回连接池
                    console.log(err);
                  });
                }
                connection.query('update groups set lastMsg = ?,time = ?,lastMsgUser = ? where groupId=?',[msg.msg,dayjs(msg.time).format('YYYY-MM-DD HH:mm:ss'),msg.fromName,res.groupId],(err)=>{
                  if(err) {
                    return  connection.rollback(() => {
                      reject('操作失败，请稍后重试');
                      connection.release(); // 释放连接回连接池
                      console.log(err);
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
                    resolve(data);
                  });
                });
              });
            });
          });
        }).then((data:any)=>{
          io.to(res.groupId).emit('toRoomClient',{username:msg.fromName,avatar:msg.fromAvatar,room:res.groupId,msg:msg.msg,time:msg.time,id:data.insertId,likes:0,dislikes:0});
        },(err)=>{
          socket.emit('clientError',{msg:err});
        });
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
            return console.log(err);
          }
          pool.query('DELETE FROM groups WHERE groupId=?',[msg.groupId],(err,data)=>{
            if(err) {
              socket.emit('clientError',{msg:'服务器错误，请重试!'});
              return console.log(err);
            }
            io.to(msg.groupId).emit('delGroup',{success:true,groupInfo:msg});
          });
          let delGroupSystemInsertSql = 'INSERT INTO systemMsg (done,hadRead,type,fromName,toName,groupName,groupId) VALUES ';
          for(let i=0;i<users.length;i++){
            delGroupSystemInsertSql += `('success',0,'delGroup','${msg.authorBy}','${users[i].username}','${msg.groupName}','${msg.groupId}')`;
            i===users.length-1?'':delGroupSystemInsertSql+=',';
          }
          pool.query(delGroupSystemInsertSql,(err)=>{
            if(err) {
              socket.emit('clientError',{msg:'服务器错误，请重试!'});
              return console.log(err);
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
  //退出群聊
  socket.on('exitGroup',(msg)=>{
    if(socket.data.username){
      pool.query('DELETE FROM groupRelationship WHERE groupId=? and username=?',[msg.groupId,socket.data.username],(err,data)=>{
        if(err) {
          socket.emit('clientError',{msg:'服务器错误，请重试!'});
          return console.log(err);
        }
        io.to(msg.groupId).emit('exitGroup',{success:true,groupInfo:msg,username:socket.data.username});
      });
      pool.query('insert into systemMsg set done=\'success\',hadRead=0,type=\'exitGroup\',fromName=?,toName=?,groupName=?,groupId=?',[socket.data.username,msg.authorBy,msg.groupName,msg.groupId],(err)=>{
        if(err) {
          socket.emit('clientError',{msg:'服务器错误，请重试!'});
          return console.log(err);
        }
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
            return console.log(err);
          }
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
            return console.log(err);
          }
          io.to(msg.group.groupId).emit('kickOutGroup',{success:true,groupInfo:msg.group,kickOutUsername:msg.kickOutUsername});
        });
        pool.query('insert into systemMsg set done=\'success\',hadRead=0,type=\'kickOutGroup\',fromName=?,toName=?,groupName=?,groupId=?',[socket.data.username,msg.kickOutUsername,msg.group.groupName,msg.group.groupId],(err)=>{
          if(err) {
            socket.emit('clientError',{msg:'服务器错误，请重试!'});
            return console.log(err);
          }
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
      pool.query('update users set isOnline = ? where username = ?',[0,socket.data.username],(err,data)=>{
        if(err) {
          socket.emit('clientError',{msg:'操作失败，请稍后重试'});
          return console.log(err);
        }
        io.emit('someoneStatusChange',{username:socket.data.username,isOnline:false});
      });
    }
  });
});
