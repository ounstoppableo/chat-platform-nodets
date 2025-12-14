import './pre-start'; // Must be the first import
import logger from 'jet-logger';
import EnvVars from '@src/constants/EnvVars';
import {httpsServer} from './server';
import pool from '@src/mysql-client/pool';
import GLOBALVAR from './globalVar';
import { redisClient } from '@src/redis-client/connect';
// **** Run **** //

const SERVER_START_MSG = ('Express server started on port: ' + 
  EnvVars.Port.toString());

redisClient.then(async redisClient=>{
  const count = await redisClient.get('msg_count');
  if(!count) {
    GLOBALVAR.MSG_COUNTS = 1;
    await redisClient.set('msg_count',1);
  }else {
    GLOBALVAR.MSG_COUNTS = +count;
  }
  const isGroupInfoExist = await redisClient.exists('groupInfo');
  if(isGroupInfoExist !==1) {
    redisClient.hSet('groupInfo','1',JSON.stringify({
      groupName: '全员总群',
      groupId: '1',
      username: 'unstoppable840',
      gavatar: '/avatar/137.jpg',
      type: 'group',
      lastMsg: null,
      time: null,
      lastMsgUser: null,
      fromAvatar: null,
      toAvatar: null,
      toUsername: null,
    }));
  }
  httpsServer.listen(EnvVars.Port, () => logger.info(SERVER_START_MSG));
});






