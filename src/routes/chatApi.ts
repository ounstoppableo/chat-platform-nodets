import { io } from '@src/upgradeServer';
import redisClient from '@src/redis/connect';
import path from 'path';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import pool from '@src/mysql/pool';

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
    io.to(msg.room).emit('toRoomClient',Object.assign({username:socket.data.username},msg));
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
