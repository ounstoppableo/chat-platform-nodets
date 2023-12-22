import jetValidator from 'jet-validator';
import { Router } from 'express';
import Paths from '../constants/Paths';
import pool from '@src/mysql/pool';


// **** Variables **** //

const apiRouter = Router();
// validate = jetValidator();

// ** Add UserRouter ** //

const chatRouter = Router();

chatRouter.get('/',(req,res)=>{
  res.json({a:1111});
});

chatRouter.ws('/',(ws,req)=>{
  console.log(11111);
  ws.on('message', function() {
    ws.send(1111);
  });
});


// Add UserRouter
apiRouter.use(Paths.Chat.Base, chatRouter);



// **** Export default **** //

export default apiRouter;
