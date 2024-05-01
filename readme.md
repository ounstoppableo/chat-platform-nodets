### redis KEY定义
| key名                          | 含义                           | 类型   | ttl  |
| ------------------------------ | ------------------------------ | ------ | ---- |
| groupInfo:{groupId}            | 存储group信息                  | hash   | -1   |
| groupMsg:{groupId}             | 存储群消息                     | hash   | 1d   |
| groupsForUser:{username}       | 存储用户所在群聊               | hash   | 7d   |
| loginCount:{ip}                | 记录ip密码错误的次数           | string | 1d   |
| ip:{ip}                        | 记录ip的注册次数，防止注册过多 | hash   | -1   |
| userInfo:{username}            | 记录用户信息                   | hash   | -1   |
| userFileUploadCount:{username} | 记录用户上传文件的次数         | string | 1d   |

### 启动教程

- mysql配置

  找到文件夹下的sqlFile，将文件输入进mysql

- 启动命令

  ~~~sh
  pnpm i
  pnpm run dev
  ~~~

  
