import './pre-start'; // Must be the first import
import logger from 'jet-logger';
import EnvVars from '@src/constants/EnvVars';
import {httpsServer} from './server';
import redisClient from '@src/redis/connect';
// **** Run **** //

const SERVER_START_MSG = ('Express server started on port: ' + 
  EnvVars.Port.toString());

redisClient.then(()=>{
  httpsServer.listen(EnvVars.Port, () => logger.info(SERVER_START_MSG));
});






