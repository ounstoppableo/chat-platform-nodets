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











