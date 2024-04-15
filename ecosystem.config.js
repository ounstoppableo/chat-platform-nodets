// 用于pm2启动

module.exports = {
    apps: [
      {
        name: "chat-platform",
        script: "./src/index.ts",
        interpreter: "./node_modules/.bin/ts-node",
        exec_mode: "cluster",
      },
    ],
  };