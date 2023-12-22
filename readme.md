### 前言

这是一个聊天平台的后端系统，聊天室大家都知道，最基本的技术就是服务器推的websocket，所以本项目中会基于websocket进行聊天后端服务器的搭建，但是一个项目，必须要基于以前的项目有所增量，才能让自己有所收获。

因为之前我做了一个博客系统，博客系统的后端就是简单的查数据库然后定义接口返回数据，甚至连类型都没有定义，就咔咔写，也没什么错误预警机制，如果这个聊天平台的后端系统也是如此，那么对我而言这个项目或许做起来是没什么意义的。

于是我就思考，是不是应该给这个项目加点料，考虑到聊天室的实时性、可拓展性，只用mysql作为数据存储的工具显然是不够的，于是我考虑使用redis+mysql进行数据存储；考虑到之前没有注重类型控制，于是在这次我想把ts集成到node中。

总的来说，基本的框架就是：websocket+redis+mysql+typescript

### 项目搭建

#### 配置ts环境

~~~sh
npm install -g express-generator-typescript
~~~

~~~
npx express-generator-typescript "chat-platform-nodets"
~~~

#### https升级&websocket升级

~~~sh
npm install https express-ws
~~~

~~~ts
//upgradeToWs.ts
import express from 'express';
import expressWs from 'express-ws';
import fs from 'fs';
import path from 'path';
import https from 'https';

const app:any = express();

//进行https升级
const httpsServer = https.createServer({
  key: fs.readFileSync(path.resolve(__dirname,'../cert/server.key')),
  cert: fs.readFileSync(path.resolve(__dirname,'../cert/server.crt')),
}, app);

//ws升级
expressWs(app,httpsServer);

//暴露出app，以便添加路由/中间件
//由于js是引用数据类型，所以即使在添加中间件之前进行https升级，最后的路由也能绑定在服务器上
export {app};
export default httpsServer;
~~~

~~~ts
/**
 * server.ts
 */
import {app} from '@src/upgradeToWs';


import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import path from 'path';
import helmet from 'helmet';
import express, { Request, Response, NextFunction } from 'express';

import logger from 'jet-logger';

import 'express-async-errors';

import chatRouter from '@src/routes/chatApi';
import Paths from '@src/constants/Paths';

import EnvVars from '@src/constants/EnvVars';
import HttpStatusCodes from '@src/constants/HttpStatusCodes';

import { NodeEnvs } from '@src/constants/misc';
import { RouteError } from '@src/other/classes';
import userRouter from '@src/routes/userApi';

//。。。
//这里是添加路由的逻辑
//app.use(***)

//将添加完路由后的httpsServer暴露出去
//这里可能有点绕，我们添加路由实际上是给app添加，但是最终的路由都会反馈到httpsServer上
//所以我们必须引用这里的httpsServer去监听服务，如果引用上面upgradeToWs.ts里的httpsServer去监听，那么server.ts文件就不会被执行，路由也就没被加上
export {default as httpsServer} from './upgradeToWs';
~~~

### 难点

#### 数据库数据操作问题

我们在进行数据库插入的时候，必须要遵循数据库事务性原则（acid）

##### 数据库数据插入保证原子性

这里主要讲事务的原子性（a）

假设我们要进行一个多表的同时插入，如果其中一个插入操作失败，那么我们本次的所有操作都要进行回滚，否则就会产生有的表有数据了，有的表没有，这就会产生许多脏数据，对我们项目开发造成极大的风险

下面是创建事务的例子：

~~~ts
const mysql = require('mysql');

// 创建数据库连接池
const pool = mysql.createPool({
  connectionLimit: 10, // 连接池的最大连接数
  host: 'your_database_host',
  user: 'your_database_user',
  password: 'your_database_password',
  database: 'your_database_name',
});

// 从连接池中获取连接并执行查询
pool.getConnection((getConnectionError, connection) => {
  if (getConnectionError) {
    console.error('Error getting connection from pool:', getConnectionError);
    return;
  }

  // 开始事务
  connection.beginTransaction((beginTransactionError) => {
    if (beginTransactionError) {
      connection.release(); // 释放连接回连接池
      console.error('Error starting transaction:', beginTransactionError);
      return;
    }

    // 定义插入数据的值
    const valuesTable1 = [['value1a', 'value2a'], ['value1b', 'value2b'], ['value1c', 'value2c']];
    const valuesTable2 = [['value3a', 'value4a'], ['value3b', 'value4b'], ['value3c', 'value4c']];

    // 插入到表1
    connection.query('INSERT INTO table1 (column1, column2) VALUES ?', [valuesTable1], (queryError1, results1) => {
      if (queryError1) {
          //一个表插入失败就回滚，并且停止当前事务
        return connection.rollback(() => {
          connection.release(); // 释放连接回连接池
          console.error('Error inserting into table1:', queryError1);
        });
      }

      // 插入到表2
      connection.query('INSERT INTO table2 (column3, column4) VALUES ?', [valuesTable2], (queryError2, results2) => {
        if (queryError2) {
          return connection.rollback(() => {
            connection.release(); // 释放连接回连接池
            console.error('Error inserting into table2:', queryError2);
          });
        }

        // 提交事务
        connection.commit((commitError) => {
          if (commitError) {
            return connection.rollback(() => {
              connection.release(); // 释放连接回连接池
              console.error('Error committing transaction:', commitError);
            });
          }

          // 释放连接回连接池
          connection.release();

          console.log('Transaction committed successfully!');
        });
      });
    });
  });
});
~~~











