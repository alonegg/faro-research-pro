# 部署到 VPS（自用 + 朋友共享）

目标:把 Faro Research Pro 部署到一台 VPS,自己作 admin,
给几个朋友开账号,他们用 API key 登录,各自的会话/记忆完全隔离。

总耗时:**15 分钟**(假设域名已经解析、Docker 已经装好)。

---

## 0. 前置

- 一台 VPS(2 vCPU / 2GB RAM 起步够用)
  - Ubuntu 22.04+ / Debian 12+ 都行
  - 80 + 443 端口对外开放
- 一个域名,A 记录指向 VPS 公网 IP(例如 `faro.yourname.com`)
- Docker + Docker Compose v2 已装(VPS 上跑 `docker --version` 能见到 v20+)
- 一份 Tushare token(免费 5200 积分级别够用)
- 一份 LLM 主模型 API key(MiniMax / DeepSeek / OpenAI 都行)
- 可选:Financial Datasets AI key(美股数据)、小模型 API key(自动标题用)

---

## 1. 在 VPS 上拉代码 + 配置

```bash
ssh you@your-vps
git clone https://github.com/alonegg/faro-research-pro.git
cd faro-research-pro

# 复制示例 env, 改成真实值
cp .env.production.example .env
nano .env
```

`.env` 必填:
- `FARO_DOMAIN` — 你的域名(无 https:// 前缀,如 `faro.yourname.com`)
- `FARO_ADMIN_EMAIL` — Let's Encrypt 用,不会公开
- `FARO_ADMIN_KEY` — 生成一个长随机串。**这是你的管理员 key,后台靠它认你**:
  ```bash
  echo "fr-$(openssl rand -base64 32 | tr -d '+/=' | cut -c1-40)"
  # 输出形如: fr-xK9mRn7vQ8pTw3jL5dF2bN4hY6sZ0eA1cB
  ```
  把整串(`fr-xK9...`)填到 `FARO_ADMIN_KEY=` 后面
- `FARO_OPENAI_API_KEY` / `FARO_OPENAI_MODEL` — 主模型
- `TUSHARE_TOKEN` — A 股数据

可选填:
- `FARO_PRO_SMALL_LLM_*` — 自动标题用的小模型(配了就快得多)
- `FINANCIAL_DATASETS_API_KEY` — 美股数据

---

## 2. 启动

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d --build
```

第一次 build 大约 5-10 分钟(主要在装 Python 依赖)。

启动后:
- Caddy 自动找 Let's Encrypt 申请证书,大约 30 秒生效
- backend 在 docker 内监听 8000
- web 在 docker 内监听 80
- Caddy 在 80 / 443 对外
- 数据持久化到 `./data/`(SQLite + memory dirs)

---

## 3. 验证

```bash
# 域名能访问?
curl -I https://faro.yourname.com/
# 期待: HTTP/2 200

# health 端点
curl https://faro.yourname.com/api/health
# 期待: {"status":"ok",...,"auth_required":true}

# 看看 caddy 日志确认证书签发成功
docker compose logs caddy | grep -i "certificate"
# 期待行: "obtained certificate" 或 "certificate is valid"
```

---

## 4. 第一次登录(你 = admin)

打开 `https://faro.yourname.com/` ,弹出登录框,**粘贴你 `.env` 里的 `FARO_ADMIN_KEY`**(以 `fr-` 开头那一长串),登录。

进去后:
1. 右上角 ⚙ 设置 → 数据源,点几个"测试"按钮确认 LLM / Tushare / FD.ai 都通
2. 设置 → 用户管理(只有 admin 看得到)→ "+ 创建新用户"
   - 填朋友的邮箱(只是标识,不发邮件)
   - 选 user 角色
   - 系统返回一个 `fr-xxx` 的一次性 key
   - **复制立刻发给朋友(微信/Telegram/邮件随便)**
   - 关了这个弹窗就再也看不到了(可以重置 key 重新生成)
3. 朋友打开你的 URL,粘贴自己的 key 登录,看到自己的空白会话列表

---

## 5. 朋友开始用

朋友的视角:
- 全部界面跟你一样
- 看不到你的会话、不知道你的偏好、看不到其他朋友
- 不能进 用户管理 / 审计 / 危险操作 这些 admin tab
- 可以编辑自己的 偏好 (Soul) / 规则 (Rules) ,影响 ta 自己的 agent 行为
- 可以下载自己的 PDF / Markdown 研报

数据隔离的物理表现:
- SQLite 每行带 `user_id` 列,所有 query 自动 filter
- `data/memory/{user_id}/` 每用户独立目录
- audit log 也按 user_id 分

---

## 6. 日常运维

### 升级

```bash
cd ~/faro-research-pro
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

零 downtime(Caddy + 滚动重启)。

### 备份

数据全在 `./data/`(SQLite + memory)。最简单:

```bash
# 创建一份每日备份脚本
cat > ~/backup-faro.sh <<'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d)
cd ~/faro-research-pro
tar czf ~/backups/faro-$DATE.tar.gz data/
# 保留最近 14 天
find ~/backups -name 'faro-*.tar.gz' -mtime +14 -delete
EOF
chmod +x ~/backup-faro.sh
mkdir -p ~/backups

# 加到 crontab,每天凌晨 3 点跑
( crontab -l 2>/dev/null; echo "0 3 * * * ~/backup-faro.sh" ) | crontab -
```

恢复:停服 → 把 `data/` 替换回去 → 重启。

### 看日志

```bash
docker compose logs -f --tail=100 backend  # python 服务
docker compose logs -f --tail=100 web      # nginx 静态
docker compose logs -f --tail=100 caddy    # 反代 + HTTPS
```

### 改环境变量

改 `.env` 后:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate
```
(一定要 `--force-recreate`,否则 docker 不重读 .env)

### 紧急关停 / 维护模式

```bash
docker compose down              # 停服(数据保留)
docker compose down -v           # 停服 + 删 caddy 卷(证书要重申)
docker compose up -d             # 重启
```

---

## 7. 安全 checklist

- [x] HTTPS 强制(Caddy 自动)
- [x] HSTS / X-Frame-Options / CSP 头(Caddy 已配)
- [x] FARO_AUTH_REQUIRED=1
- [x] API key 服务端只存 SHA-256 hash
- [x] 用户数据物理隔离(per-user memory dir + SQL user_id filter)
- [ ] 防火墙只开 22/80/443(`ufw allow 22 80 443 && ufw enable`)
- [ ] SSH 改 key 登录、禁 password
- [ ] Docker 容器以非 root 运行(基础镜像未配置,后续可加)

---

## 8. 常见问题

**Q: Caddy 一直拿不到证书?**
A: 检查 (a) DNS 是不是真指到 VPS,(b) 80/443 端口对外开了没,
   (c) 域名 24h 内有没有反复 reload 触发 Let's Encrypt 限流。
   `docker compose logs caddy | grep -i error` 看具体错误。

**Q: 朋友说看到 "401 invalid api key" ?**
A: 你给他的 key 错了 / key 已被你重置 / 你删了他的账号。
   到 设置 → 用户管理 重新给他生成 key。

**Q: 我重装系统后能直接用 .env 重启吗?**
A: 数据全在 `./data/`,只要这个目录在,启起来就跟之前一样。
   Caddy 证书在命名 volume 里(`caddy_data`),也会自动恢复。

**Q: 可以让朋友共享某个会话吗?**
A: 当前版本不支持,数据完全隔离。下个版本会做"可分享会话"功能。
