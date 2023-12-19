import { Router } from 'express';
import jetValidator from 'jet-validator';

import Paths from '../constants/Paths';
import pool from '@src/mysql/pool';


// **** Variables **** //

const apiRouter = Router();
// validate = jetValidator();


// ** Add UserRouter ** //

const chatRouter = Router();

chatRouter.get('/',function (req:any, res:any) {
  pool.query('select * from users', (data:any, err:any) => {
    if (err) console.log(err);
    else console.log(data);

  });
  res.json({a:111});
});

// Add UserRouter
apiRouter.use(Paths.Chat.Base, chatRouter);


// **** Export default **** //

export default apiRouter;
