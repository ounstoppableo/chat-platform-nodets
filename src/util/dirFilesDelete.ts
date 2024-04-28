import path from 'path';
import fs from 'fs';
import custom from './log';
import dayjs from 'dayjs';

export default function  dirFilesDelete(filepath:string,expire:number){
  fs.readdir(filepath, (err, files) => {
    if (err) {
      custom.log(err);
    }
    files.forEach((filename)=>{
      fs.stat(path.resolve(filepath,filename), (err, stats) => {
        if (err) {
          custom.log('获取文件状态信息时出错：', err);
          return;
        }
          
        // 获取文件的创建时间
        const creationTime = dayjs(stats.birthtime).unix();
        const currentTime = Date.now()/1000;
        if(currentTime - creationTime > expire) {
          fs.unlink(path.resolve(filepath,filename), (err) => {
            if (err) {
              custom.log('删除文件时出错：', err);
            }
          });
        }
      });
    });
  });
}

