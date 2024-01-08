import { io } from '@src/upgradeServer';
import redisClient from '@src/redis/connect';
import path from 'path';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import pool from '@src/mysql/pool';
import dayjs from 'dayjs';

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
        return console.log(err);
      }
      io.emit('someoneStatusChange',{username:socket.data.username,isOnline:true});
    });
  }
  //加入群聊
  socket.on('joinRoom',(groupIds)=>{
    if(!!groupIds.length){
      groupIds.forEach((item:any)=>{
        socket.data.groups?socket.data.groups.push(item.groupId):socket.data.groups=[item.groupId];
        socket.join(item.groupId);
      });
    }
  });
  //接收客户端的消息
  socket.on('msgToServer',(msg)=>{
    pool.getConnection((err,connection)=>{
      if(err) {
        return  console.log(err);
      }
      connection.beginTransaction((err)=>{
        if(err) {
          connection.release();
          return  console.log(err);
        }
        connection.query('insert gmessage set username=?,time=?,text=?,timestamp=?,likes=?,dislikes=?,groupId=?',[socket.data.username,dayjs(msg.time).format('YYYY-MM-DD HH:mm:ss'),msg.msg,dayjs(msg.time).unix(),0,0,msg.room],(err,data)=>{
          if(err) {
            return  connection.rollback(() => {
              connection.release(); // 释放连接回连接池
              console.log(err);
            });
          }
          connection.query('update groups set lastMsg = ?,date = ?,lastMsgUser = ? where groupId=?',[msg.msg,dayjs(msg.time).format('YYYY-MM-DD HH:mm:ss'),socket.data.username,msg.room],(err)=>{
            if(err) {
              return  connection.rollback(() => {
                connection.release(); // 释放连接回连接池
                console.log(err);
              });
            }
            connection.commit((commitError)=>{
              if (commitError) {
                return connection.rollback(() => {
                  connection.release(); // 释放连接回连接池
                  console.error('Error committing transaction:', commitError);
                });
              }
              // 释放连接回连接池
              connection.release();
              io.to(msg.room).emit('toRoomClient',Object.assign({username:socket.data.username,id:data.insertId,likes:0,dislikes:0},msg));
            });
          });
        });
      });
    });

  });
  //喜欢某消息
  socket.on('likeSbMsg',(msg)=>{
    pool.query('update gmessage set likes = ? where id=?',[msg.likes+1,msg.msgId],(err,data)=>{
      if(err) {
        return  console.log(err);
      }
      io.to(msg.room).emit('sbLikeMsg',{success:true,likes:msg.likes+1,msgId:msg.msgId,room:msg.room,type:'like'});
    });
  });
  //取消点赞
  socket.on('cancelLikeSbMsg',(msg)=>{
    pool.query('update gmessage set likes = ? where id=?',[msg.likes-1,msg.msgId],(err,data)=>{
      if(err) {
        return  console.log(err);
      }
      io.to(msg.room).emit('cancelSbLikeMsg',{success:true,likes:msg.likes-1,msgId:msg.msgId,room:msg.room,type:'cancelLike'});
    });
  });

  //不喜欢某消息
  socket.on('dislikeSbMsg',(msg)=>{
    pool.query('update gmessage set dislikes = ? where id=?',[msg.dislikes+1,msg.msgId],(err,data)=>{
      if(err) {
        return  console.log(err);
      }
      io.to(msg.room).emit('sbDislikeMsg',{success:true,dislikes:msg.dislikes+1,msgId:msg.msgId,room:msg.room});
    });
  });
  //取消不喜欢
  socket.on('cancelDislikeSbMsg',(msg)=>{
    pool.query('update gmessage set dislikes = ? where id=?',[msg.dislikes-1,msg.msgId],(err,data)=>{
      if(err) {
        return  console.log(err);
      }
      io.to(msg.room).emit('cancelSbDislikeMsg',{success:true,dislikes:msg.dislikes-1,msgId:msg.msgId,room:msg.room});
    });
  });

  //离开
  socket.on('disconnect',(msg)=>{
    if(socket.data.username) {
      pool.query('update users set isOnline = ? where username = ?',[0,socket.data.username],(err,data)=>{
        if(err) {
          return console.log(err);
        }
        io.emit('someoneStatusChange',{username:socket.data.username,isOnline:false});
      });
    }
  });
});
