import { io } from '@src/upgradeServer';
import redisClient from '@src/redis/connect';
import path from 'path';
import jwt from 'jsonwebtoken';
import fs from 'fs';

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

//处理错误
io.on('error',(err)=>{
  console.log(err);
});

io.on('connection',(socket)=>{
  const generalGroup = '1';
  socket.on('joinRoom',(msg)=>{
    msg.forEach((item:any)=>{
      if(item.groupId===generalGroup) socket.join(generalGroup);
    });
  });
  socket.on('msgToServer',(msg)=>{
    io.to(msg.room).emit('toRoomClient',Object.assign({username:socket.data.username},msg));
  });
});
