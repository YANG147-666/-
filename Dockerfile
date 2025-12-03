# 使用官方 Node.js 轻量级镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 并安装依赖
COPY package.json .
RUN npm install --registry=https://registry.npmmirror.com

# 复制所有源代码
COPY . .

# 暴露端口 (云托管默认通常是 80，我们需要在 server.js 里适配，见下文)
EXPOSE 80

# 启动命令
CMD ["npm", "start"]