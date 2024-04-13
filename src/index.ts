import './pre-start'; // Must be the first import
import logger from 'jet-logger';
import EnvVars from '@src/constants/EnvVars';
import {httpsServer} from './server';
import pool from '@src/mysql/pool';
import GLOBALVAR from './globalVar';
import { redisClient } from '@src/redis/connect';
// **** Run **** //

const SERVER_START_MSG = ('Express server started on port: ' + 
  EnvVars.Port.toString());

redisClient.then(async redisClient=>{
  const count = await redisClient.get('msg_count');
  if(count) {
    GLOBALVAR.MSG_COUNTS = +count;
    pool.query('select * from groups',async (err,groups)=>{
      if(err) {
        return console.log(err);
      }
      for(let i=0;i<groups.length;i++){
        await redisClient.hSet('groupInfo',groups[i].groupId,JSON.stringify(groups[i]));
      }
      pool.query('select username,region,avatar,isOnline,uid from users',async (err,users)=>{
        if(err) {
          return console.log(err);
        }
        for(let i=0;i<users.length;i++){
          await redisClient.hSet('userInfo',users[i].username,JSON.stringify(users[i]));
        }
        httpsServer.listen(EnvVars.Port, () => logger.info(SERVER_START_MSG));
      });
    });
  }else {
    pool.query('select COUNT(*) from gmessage',((err,data)=>{
      if(err) {
        return console.log(err);
      }
      GLOBALVAR.MSG_COUNTS = data[0]['COUNT(*)']+1;
      pool.query('select * from groups', async (err,groups)=>{
        if(err) {
          return console.log(err);
        }
        for(let i=0;i<groups.length;i++){
          await redisClient.hSet('groupInfo',groups[i].groupId,JSON.stringify(groups[i]));
        }
        pool.query('select username,region,avatar,isOnline,uid from users',async (err,users)=>{
          if(err) {
            return console.log(err);
          }
          for(let i=0;i<users.length;i++){
            await redisClient.hSet('userInfo',users[i].username,JSON.stringify(users[i]));
          }
          httpsServer.listen(EnvVars.Port, () => logger.info(SERVER_START_MSG));
        });
      });
    }));    
  }

});






