import { createClient } from 'redis';
import {createPool} from 'generic-pool';

// 创建 Redis 客户端
const redisClient = createClient({
  url: 'redis://8.130.54.105:6379',
  database: 1,
}).on('error', err =>{ 
  console.log('Redis Client Error', err);},
).connect();


export {redisClient};
