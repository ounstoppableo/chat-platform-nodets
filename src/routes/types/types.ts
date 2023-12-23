import * as e from 'express';
import { Query } from 'express-serve-static-core';

import { ISessionUser } from '@src/models/User';


// **** Express **** //

export interface IReq<T = void> extends e.Request {
  body: T;
}

export interface IReqQuery<T extends Query, U = void> extends e.Request {
  query: T;
  body: U;
}

export interface IRes extends e.Response {
  locals: {
    sessionUser: ISessionUser;
  };
}

export enum resCode {
  tokenErr = 403,
  success = 200,
  serverErr = 500,
}

export enum codeMapMsg {
  'token失效' = 403,
  '请求成功' = 200,
  '服务器错误' = 500
}