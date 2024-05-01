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

  - 找到文件夹下的sqlFile，将文件输入进mysql
  - 修改src/mysql下的文件，改为pool.ts，以及内容按自己的环境去修改
- redis配置
  - 启动redis到6381端口
  - 修改src/redis下的文件，改为connect.ts，以及内容按自己的环境修改
- 密钥配置
  - 自己生成ssl证书放在根目录的cert文件下，需要自己创建文件夹，证书命名为server.crt和server.key
  - 生成jwt的密钥，放在根目录的文件夹key下，需要自己创建文件，文件夹名称为

- 启动命令

  ~~~sh
  pnpm i
  pnpm run dev
  ~~~

  
