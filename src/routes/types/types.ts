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
  paramsErr = 404,
  inexistenceErr = 405,
  limitErr = 201,
  fileSizeErr = 202,
  passwordErr = 401
}

export enum codeMapMsg {
  'token失效' = 403,
  '请求成功' = 200,
  '服务器错误' = 500,
  '参数错误' = 404,
  '超过创建限制' = 201,
  '你希望操作的对象不存在或已被删除' = 405,
  '文件大小超过限制' = 202,
  '密码错误' = 401
}

export interface Res<T> {
  code: number,
  data: T,
  msg:string
}