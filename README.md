# 🎫 搶票記錄 Discord 機器人

記錄多人搶票成功/失敗次數、張數並計算成功率的 Discord Bot。

## ✨ 功能特色

- ✅ 記錄多人搶票成功/失敗
- 🎟️ 記錄搶到的張數
- 📅 支援活動日期記錄
- 📊 個人統計與成功率計算
- 🏆 多種排行榜（成功率/張數/成功次數）
- 📈 活動統計與參與者詳情
- 💾 JSON 檔案持久化儲存

## 📦 安裝步驟

### 1. 建立 Discord Bot

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 點擊「New Application」
3. 進入「Bot」頁面 → 「Add Bot」
4. 複製 Token
5. 開啟 `MESSAGE CONTENT INTENT`

### 2. 邀請 Bot 到伺服器

1. 進入「OAuth2」→「URL Generator」
2. Scopes 勾選：`bot`、`applications.commands`
3. Bot Permissions 勾選：
   - Send Messages
   - Embed Links
   - Use Slash Commands
4. 用生成的網址邀請 Bot

### 3. 執行

```bash
# 安裝依賴
npm install

# 設定 Token (Windows)
set DISCORD_BOT_TOKEN=你的Token

# 設定 Token (Linux/Mac)
export DISCORD_BOT_TOKEN="你的Token"

# 啟動
npm start
```

## 📋 指令列表

### 📝 記錄指令
| 指令 | 說明 |
|------|------|
| `/成功 <活動> <張數> [日期] [備註]` | 記錄搶票成功，需輸入搶到張數 |
| `/失敗 <活動> [日期] [備註]` | 記錄搶票失敗 |
| `/刪除` | 刪除最後一筆記錄 |

### 📊 統計指令
| 指令 | 說明 |
|------|------|
| `/我的統計` | 查看個人統計（成功率、總張數等） |
| `/查詢成員 @誰` | 查看他人統計 |
| `/全員統計` | 所有人的統計總覽 |
| `/排行榜 [排序]` | 排行榜（可依成功率/張數/成功次數排序） |

### 🎫 活動指令
| 指令 | 說明 |
|------|------|
| `/活動列表` | 查看所有活動及統計 |
| `/活動詳情 <活動>` | 活動詳細統計與參與者 |
| `/新增活動 <活動> [日期]` | 預先建立活動 |
| `/刪除活動 <活動>` | 刪除活動（需管理員權限） |

### 🔧 其他指令
| 指令 | 說明 |
|------|------|
| `/清除我的記錄` | 清除自己的所有記錄 |
| `/幫助` | 顯示使用說明 |

## 💡 使用範例

```
/成功 五月天演唱會 2 2024-12-25 秒殺成功！
/失敗 周杰倫演唱會 2024-12-30 網站當掉
/排行榜 張數
/活動詳情 五月天演唱會
```

## 🚀 部署

### PM2（推薦）

```bash
npm install -g pm2
pm2 start Bot.js --name ticket-bot
pm2 save
pm2 startup
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "start"]
```

```bash
docker build -t ticket-bot .
docker run -d -e DISCORD_BOT_TOKEN="你的Token" -v $(pwd)/data:/app ticket-bot
```

## 📁 資料結構

資料儲存在 `ticket_data.json`：

```json
{
  "users": {
    "用戶ID": {
      "name": "顯示名稱",
      "success": 5,
      "fail": 2,
      "records": [
        {
          "event": "五月天演唱會",
          "result": "success",
          "ticketCount": 2,
          "date": "2024-12-25",
          "note": "秒殺成功",
          "time": "2024-12-01T10:30:00.000Z"
        }
      ]
    }
  },
  "events": {
    "五月天演唱會": {
      "success": 3,
      "fail": 4,
      "totalTickets": 6,
      "date": "2024-12-25",
      "participants": ["用戶ID1", "用戶ID2"],
      "createdAt": "2024-12-01T10:00:00.000Z"
    }
  }
}
```

## 📊 統計說明

- **成功率** = 成功次數 / 總次數 × 100%
- **個人總張數** = 該用戶所有成功記錄的張數總和
- **活動總張數** = 該活動所有成功記錄的張數總和
