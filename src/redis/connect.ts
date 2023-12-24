import { createClient } from 'redis';

export default new Promise((resolve,reject)=>{
  const redisClient = createClient({
    url: 'redis://8.130.54.105:6379',
  }).on('error', err =>{ 
    console.log('Redis Client Error', err);
    reject(err);},
  ).on('ready',()=>{
    console.log('Redis Client Ready');
    resolve(redisClient);
  }).connect();
});