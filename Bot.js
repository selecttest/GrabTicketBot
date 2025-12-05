const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ===== 簡易 HTTP 服務器（給 Render 健康檢查用）=====
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('GrabTicketBot is running!');
}).listen(PORT, () => {
    console.log(`✅ HTTP 服務器運行於 port ${PORT}`);
});

// ===== Google Sheets 設定 =====
// 請在 Render 環境變數中設定以下值：
// GOOGLE_SHEETS_ID - 你的 Google Sheets ID
// GOOGLE_SERVICE_ACCOUNT_EMAIL - 服務帳號 Email
// GOOGLE_PRIVATE_KEY - 服務帳號私鑰（JSON 中的 private_key）

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET_NAME = '記錄'; // 工作表名稱

// Google Sheets 認證
let sheets;

async function initGoogleSheets() {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        
        sheets = google.sheets({ version: 'v4', auth });
        console.log('✅ Google Sheets 連線成功');
        
        // 確保標題行存在
        await ensureHeaders();
    } catch (error) {
        console.error('❌ Google Sheets 連線失敗:', error.message);
    }
}

// 確保標題行存在
async function ensureHeaders() {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A1:H1`
        });
        
        if (!response.data.values || response.data.values.length === 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A1:H1`,
                valueInputOption: 'RAW',
                resource: {
                    values: [['時間', '用戶ID', '用戶名稱', '活動', '結果', '張數', '活動日期', '備註']]
                }
            });
            console.log('✅ 已建立標題行');
        }
    } catch (error) {
        console.error('❌ 確保標題行失敗:', error.message);
    }
}

// 新增記錄到 Google Sheets
async function appendRecord(userId, userName, eventName, result, ticketCount, eventDate, note) {
    try {
        const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:H`,
            valueInputOption: 'RAW',
            resource: {
                values: [[now, userId, userName, eventName, result, ticketCount, eventDate || '', note || '']]
            }
        });
        
        return true;
    } catch (error) {
        console.error('❌ 寫入 Google Sheets 失敗:', error.message);
        return false;
    }
}

// 取得所有記錄
async function getAllRecords() {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A2:H`
        });
        
        return response.data.values || [];
    } catch (error) {
        console.error('❌ 讀取 Google Sheets 失敗:', error.message);
        return [];
    }
}

// 刪除最後一筆記錄（特定用戶）
async function deleteLastRecord(userId) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A2:H`
        });
        
        const rows = response.data.values || [];
        let lastRowIndex = -1;
        let lastRecord = null;
        
        // 找到該用戶的最後一筆記錄
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i][1] === userId) {
                lastRowIndex = i + 2; // +2 因為從第2行開始，且索引從0開始
                lastRecord = rows[i];
                break;
            }
        }
        
        if (lastRowIndex === -1) {
            return null;
        }
        
        // 清除該行
        await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A${lastRowIndex}:H${lastRowIndex}`
        });
        
        return {
            event: lastRecord[3],
            result: lastRecord[4],
            ticketCount: parseInt(lastRecord[5]) || 0
        };
    } catch (error) {
        console.error('❌ 刪除記錄失敗:', error.message);
        return null;
    }
}

// 計算用戶統計
async function getUserStats(userId) {
    const records = await getAllRecords();
    const userRecords = records.filter(r => r[1] === userId);
    
    if (userRecords.length === 0) return null;
    
    let success = 0, fail = 0, totalTickets = 0;
    const eventBreakdown = {};
    
    for (const record of userRecords) {
        const eventName = record[3];
        const result = record[4];
        const tickets = parseInt(record[5]) || 0;
        
        if (result === '成功') {
            success++;
            totalTickets += tickets;
        } else {
            fail++;
        }
        
        if (!eventBreakdown[eventName]) {
            eventBreakdown[eventName] = { success: 0, fail: 0, tickets: 0 };
        }
        if (result === '成功') {
            eventBreakdown[eventName].success++;
            eventBreakdown[eventName].tickets += tickets;
        } else {
            eventBreakdown[eventName].fail++;
        }
    }
    
    const total = success + fail;
    const rate = total > 0 ? (success / total * 100) : 0;
    
    return { success, fail, total, rate, totalTickets, eventBreakdown, records: userRecords };
}

// 計算活動統計
async function getEventStats(eventName) {
    const records = await getAllRecords();
    const eventRecords = records.filter(r => r[3] === eventName);
    
    if (eventRecords.length === 0) return null;
    
    let success = 0, fail = 0, totalTickets = 0;
    const participants = new Set();
    
    for (const record of eventRecords) {
        const result = record[4];
        const tickets = parseInt(record[5]) || 0;
        participants.add(record[1]);
        
        if (result === '成功') {
            success++;
            totalTickets += tickets;
        } else {
            fail++;
        }
    }
    
    const total = success + fail;
    const rate = total > 0 ? (success / total * 100) : 0;
    
    return { success, fail, total, rate, totalTickets, participantCount: participants.size, records: eventRecords };
}

// 取得所有活動名稱
async function getAllEvents() {
    const records = await getAllRecords();
    const events = new Set();
    for (const record of records) {
        if (record[3]) events.add(record[3]);
    }
    return Array.from(events);
}

// 取得所有用戶統計
async function getAllUserStats() {
    const records = await getAllRecords();
    const userStats = {};
    
    for (const record of records) {
        const userId = record[1];
        const userName = record[2];
        const result = record[4];
        const tickets = parseInt(record[5]) || 0;
        
        if (!userStats[userId]) {
            userStats[userId] = { name: userName, success: 0, fail: 0, tickets: 0 };
        }
        
        if (result === '成功') {
            userStats[userId].success++;
            userStats[userId].tickets += tickets;
        } else {
            userStats[userId].fail++;
        }
    }
    
    return userStats;
}

// ===== Discord Bot =====

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 註冊斜線指令
const commands = [
    new SlashCommandBuilder()
        .setName('成功')
        .setDescription('記錄搶票成功')
        .addStringOption(opt => opt.setName('活動').setDescription('活動名稱').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('張數').setDescription('搶到的張數').setRequired(true).setMinValue(1).setMaxValue(100))
        .addStringOption(opt => opt.setName('日期').setDescription('活動日期 (例如: 2024-12-25)').setRequired(false))
        .addStringOption(opt => opt.setName('備註').setDescription('備註（可選）').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('失敗')
        .setDescription('記錄搶票失敗')
        .addStringOption(opt => opt.setName('活動').setDescription('活動名稱').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('日期').setDescription('活動日期 (例如: 2024-12-25)').setRequired(false))
        .addStringOption(opt => opt.setName('備註').setDescription('備註（可選）').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('我的統計')
        .setDescription('查看個人搶票統計'),
    
    new SlashCommandBuilder()
        .setName('查詢成員')
        .setDescription('查看特定成員的統計')
        .addUserOption(opt => opt.setName('成員').setDescription('要查詢的成員').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('全員統計')
        .setDescription('查看所有成員的統計'),
    
    new SlashCommandBuilder()
        .setName('排行榜')
        .setDescription('查看搶票排行榜')
        .addStringOption(opt => 
            opt.setName('排序')
                .setDescription('排序方式')
                .setRequired(false)
                .addChoices(
                    { name: '成功率', value: 'rate' },
                    { name: '總張數', value: 'tickets' },
                    { name: '成功次數', value: 'success' }
                )),
    
    new SlashCommandBuilder()
        .setName('活動列表')
        .setDescription('查看所有活動'),
    
    new SlashCommandBuilder()
        .setName('活動詳情')
        .setDescription('查看特定活動的詳細統計')
        .addStringOption(opt => opt.setName('活動').setDescription('活動名稱').setRequired(true).setAutocomplete(true)),
    
    new SlashCommandBuilder()
        .setName('刪除')
        .setDescription('刪除自己最後一筆記錄'),
    
    new SlashCommandBuilder()
        .setName('幫助')
        .setDescription('顯示使用說明'),
    
    new SlashCommandBuilder()
        .setName('有票噴霧')
        .setDescription('🎉 慶祝搶到票！噴出慶祝圖片')
];

// Bot 事件
client.once('ready', async () => {
    console.log(`✅ Bot 已上線: ${client.user.tag}`);
    
    // 初始化 Google Sheets
    await initGoogleSheets();
    
    try {
        await client.application.commands.set(commands);
        console.log('✅ 已註冊斜線指令');
    } catch (error) {
        console.error('❌ 註冊指令失敗:', error);
    }
});

// 處理互動
client.on('interactionCreate', async interaction => {
    // 自動完成
    if (interaction.isAutocomplete()) {
        const events = await getAllEvents();
        const focused = interaction.options.getFocused().toLowerCase();
        const filtered = events
            .filter(e => e.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(e => ({ name: e, value: e }));
        
        await interaction.respond(filtered);
        return;
    }
    
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName } = interaction;
    
    try {
        // ===== /成功 =====
        if (commandName === '成功') {
            await interaction.deferReply();
            
            const userId = interaction.user.id;
            const userName = interaction.user.displayName || interaction.user.username;
            const eventName = interaction.options.getString('活動');
            const ticketCount = interaction.options.getInteger('張數');
            const eventDate = interaction.options.getString('日期') || '';
            const note = interaction.options.getString('備註') || '';
            
            const success = await appendRecord(userId, userName, eventName, '成功', ticketCount, eventDate, note);
            
            if (!success) {
                await interaction.editReply({ content: '❌ 記錄失敗，請稍後再試' });
                return;
            }
            
            const stats = await getUserStats(userId);
            const eventStats = await getEventStats(eventName);
            
            const embed = new EmbedBuilder()
                .setTitle('🎉 搶票成功！')
                .setColor(0x00ff00)
                .addFields(
                    { name: '🎫 活動', value: eventName, inline: true },
                    { name: '🎟️ 張數', value: `${ticketCount} 張`, inline: true },
                    { name: '👤 記錄者', value: userName, inline: true }
                );
            
            if (eventDate) {
                embed.addFields({ name: '📅 活動日期', value: eventDate, inline: true });
            }
            
            embed.addFields(
                { name: '📊 個人成功率', value: `${stats.rate.toFixed(1)}% (${stats.success}/${stats.total})`, inline: true },
                { name: '🎟️ 個人總張數', value: `${stats.totalTickets} 張`, inline: true },
                { name: '📈 活動成功率', value: `${eventStats.rate.toFixed(1)}% (${eventStats.success}/${eventStats.total})`, inline: true },
                { name: '🎫 活動總張數', value: `${eventStats.totalTickets} 張`, inline: true }
            );
            
            if (note) embed.addFields({ name: '📝 備註', value: note, inline: false });
            
            embed.setThumbnail(interaction.user.displayAvatarURL())
                .setFooter({ text: '📊 資料已同步到 Google Sheets' })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
        }
        
        // ===== /失敗 =====
        else if (commandName === '失敗') {
            await interaction.deferReply();
            
            const userId = interaction.user.id;
            const userName = interaction.user.displayName || interaction.user.username;
            const eventName = interaction.options.getString('活動');
            const eventDate = interaction.options.getString('日期') || '';
            const note = interaction.options.getString('備註') || '';
            
            const success = await appendRecord(userId, userName, eventName, '失敗', 0, eventDate, note);
            
            if (!success) {
                await interaction.editReply({ content: '❌ 記錄失敗，請稍後再試' });
                return;
            }
            
            const stats = await getUserStats(userId);
            const eventStats = await getEventStats(eventName);
            
            const embed = new EmbedBuilder()
                .setTitle('😢 搶票失敗')
                .setColor(0xff0000)
                .addFields(
                    { name: '🎫 活動', value: eventName, inline: true },
                    { name: '👤 記錄者', value: userName, inline: true }
                );
            
            if (eventDate) {
                embed.addFields({ name: '📅 活動日期', value: eventDate, inline: true });
            }
            
            embed.addFields(
                { name: '📊 個人成功率', value: `${stats.rate.toFixed(1)}% (${stats.success}/${stats.total})`, inline: true },
                { name: '📈 活動成功率', value: `${eventStats.rate.toFixed(1)}% (${eventStats.success}/${eventStats.total})`, inline: true }
            );
            
            if (note) embed.addFields({ name: '📝 備註', value: note, inline: false });
            
            embed.setThumbnail(interaction.user.displayAvatarURL())
                .setFooter({ text: '📊 資料已同步到 Google Sheets' })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
        }
        
        // ===== /我的統計 =====
        else if (commandName === '我的統計') {
            await interaction.deferReply();
            
            const userId = interaction.user.id;
            const stats = await getUserStats(userId);
            
            if (!stats) {
                await interaction.editReply({ content: '📊 你還沒有任何搶票記錄！使用 `/成功` 或 `/失敗` 開始記錄' });
                return;
            }
            
            let breakdownText = '';
            for (const [event, counts] of Object.entries(stats.eventBreakdown)) {
                const total = counts.success + counts.fail;
                const rate = (counts.success / total * 100).toFixed(0);
                breakdownText += `**${event}**: ${rate}% (${counts.success}/${total}) | 🎟️ ${counts.tickets}張\n`;
            }
            
            const recent = stats.records.slice(-5).reverse();
            const recentText = recent.map(r => {
                const icon = r[4] === '成功' ? '✅' : '❌';
                const tickets = r[4] === '成功' ? ` (${r[5] || 0}張)` : '';
                return `${icon} ${r[3]}${tickets}`;
            }).join('\n');
            
            const embed = new EmbedBuilder()
                .setTitle(`📊 ${interaction.user.displayName || interaction.user.username} 的搶票統計`)
                .setColor(0x0099ff)
                .setThumbnail(interaction.user.displayAvatarURL())
                .addFields(
                    { name: '✅ 成功', value: String(stats.success), inline: true },
                    { name: '❌ 失敗', value: String(stats.fail), inline: true },
                    { name: '📈 成功率', value: `${stats.rate.toFixed(1)}%`, inline: true },
                    { name: '🎫 總次數', value: String(stats.total), inline: true },
                    { name: '🎟️ 總張數', value: `${stats.totalTickets} 張`, inline: true }
                );
            
            if (breakdownText) {
                embed.addFields({ name: '🎯 各活動統計', value: breakdownText.slice(0, 1024), inline: false });
            }
            if (recentText) {
                embed.addFields({ name: '📝 最近 5 筆', value: recentText, inline: false });
            }
            
            await interaction.editReply({ embeds: [embed] });
        }
        
        // ===== /查詢成員 =====
        else if (commandName === '查詢成員') {
            await interaction.deferReply();
            
            const member = interaction.options.getUser('成員');
            const stats = await getUserStats(member.id);
            
            if (!stats) {
                await interaction.editReply({ content: `📊 ${member.displayName || member.username} 還沒有任何搶票記錄！` });
                return;
            }
            
            const embed = new EmbedBuilder()
                .setTitle(`📊 ${member.displayName || member.username} 的搶票統計`)
                .setColor(0x0099ff)
                .setThumbnail(member.displayAvatarURL())
                .addFields(
                    { name: '✅ 成功', value: String(stats.success), inline: true },
                    { name: '❌ 失敗', value: String(stats.fail), inline: true },
                    { name: '📈 成功率', value: `${stats.rate.toFixed(1)}%`, inline: true },
                    { name: '🎫 總次數', value: String(stats.total), inline: true },
                    { name: '🎟️ 總張數', value: `${stats.totalTickets} 張`, inline: true }
                );
            
            await interaction.editReply({ embeds: [embed] });
        }
        
        // ===== /全員統計 =====
        else if (commandName === '全員統計') {
            await interaction.deferReply();
            
            const userStats = await getAllUserStats();
            
            if (Object.keys(userStats).length === 0) {
                await interaction.editReply({ content: '📊 目前還沒有任何記錄！' });
                return;
            }
            
            let totalSuccess = 0, totalFail = 0, totalTickets = 0;
            const memberStats = [];
            
            for (const [userId, info] of Object.entries(userStats)) {
                totalSuccess += info.success;
                totalFail += info.fail;
                totalTickets += info.tickets;
                
                const total = info.success + info.fail;
                const rate = total > 0 ? (info.success / total * 100) : 0;
                memberStats.push({ name: info.name, success: info.success, fail: info.fail, rate, tickets: info.tickets });
            }
            
            memberStats.sort((a, b) => b.rate - a.rate);
            
            const totalAll = totalSuccess + totalFail;
            const overallRate = totalAll > 0 ? (totalSuccess / totalAll * 100).toFixed(1) : 0;
            
            const memberLines = memberStats.map(m => 
                `**${m.name}**: ${m.rate.toFixed(1)}% (✅${m.success} ❌${m.fail}) | 🎟️ ${m.tickets}張`
            );
            
            const embed = new EmbedBuilder()
                .setTitle('📊 全員搶票統計')
                .setColor(0x0099ff)
                .setTimestamp()
                .addFields(
                    { 
                        name: '📈 整體統計', 
                        value: `成功率: **${overallRate}%**\n✅ ${totalSuccess} | ❌ ${totalFail} | 總計 ${totalAll}\n🎟️ 總張數: **${totalTickets}** 張`, 
                        inline: false 
                    },
                    { 
                        name: `👥 成員統計 (${Object.keys(userStats).length}人)`, 
                        value: memberLines.join('\n').slice(0, 1024) || '無', 
                        inline: false 
                    }
                );
            
            await interaction.editReply({ embeds: [embed] });
        }
        
        // ===== /排行榜 =====
        else if (commandName === '排行榜') {
            await interaction.deferReply();
            
            const sortBy = interaction.options.getString('排序') || 'rate';
            const userStats = await getAllUserStats();
            
            if (Object.keys(userStats).length === 0) {
                await interaction.editReply({ content: '📊 目前還沒有任何記錄！' });
                return;
            }
            
            const stats = [];
            for (const [userId, info] of Object.entries(userStats)) {
                const total = info.success + info.fail;
                if (total > 0) {
                    const rate = info.success / total * 100;
                    stats.push({ name: info.name, rate, success: info.success, fail: info.fail, total, tickets: info.tickets });
                }
            }
            
            if (sortBy === 'tickets') {
                stats.sort((a, b) => b.tickets - a.tickets || b.rate - a.rate);
            } else if (sortBy === 'success') {
                stats.sort((a, b) => b.success - a.success || b.rate - a.rate);
            } else {
                stats.sort((a, b) => b.rate - a.rate || b.total - a.total);
            }
            
            const sortTitles = { 'rate': '成功率', 'tickets': '總張數', 'success': '成功次數' };
            const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
            
            const lines = stats.slice(0, 10).map((stat, i) => {
                const medal = medals[i] || `${i + 1}.`;
                return `${medal} **${stat.name}**\n　　成功率: ${stat.rate.toFixed(1)}% | ✅ ${stat.success} ❌ ${stat.fail} | 🎟️ ${stat.tickets}張`;
            });
            
            const embed = new EmbedBuilder()
                .setTitle(`🏆 搶票排行榜 (依${sortTitles[sortBy]})`)
                .setColor(0xffd700)
                .setDescription(lines.join('\n') || '暫無資料')
                .setFooter({ text: `共 ${stats.length} 位參與者` })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
        }
        
        // ===== /活動列表 =====
        else if (commandName === '活動列表') {
            await interaction.deferReply();
            
            const events = await getAllEvents();
            
            if (events.length === 0) {
                await interaction.editReply({ content: '📋 目前還沒有任何活動記錄！' });
                return;
            }
            
            const embed = new EmbedBuilder()
                .setTitle('📋 活動列表')
                .setColor(0x9b59b6)
                .setTimestamp();
            
            for (const eventName of events.slice(0, 25)) {
                const eventStats = await getEventStats(eventName);
                if (eventStats) {
                    embed.addFields({
                        name: `🎫 ${eventName}`,
                        value: `成功率: ${eventStats.rate.toFixed(1)}%\n✅ ${eventStats.success} | ❌ ${eventStats.fail}\n🎟️ ${eventStats.totalTickets}張 | 👥 ${eventStats.participantCount}人`,
                        inline: true
                    });
                }
            }
            
            embed.setFooter({ text: `共 ${events.length} 個活動` });
            
            await interaction.editReply({ embeds: [embed] });
        }
        
        // ===== /活動詳情 =====
        else if (commandName === '活動詳情') {
            await interaction.deferReply();
            
            const eventName = interaction.options.getString('活動');
            const eventStats = await getEventStats(eventName);
            
            if (!eventStats) {
                await interaction.editReply({ content: `❌ 找不到活動：${eventName}` });
                return;
            }
            
            // 計算各參與者統計
            const participantStats = {};
            for (const record of eventStats.records) {
                const odId = record[1];
                const userName = record[2];
                const result = record[4];
                const tickets = parseInt(record[5]) || 0;
                
                if (!participantStats[odId]) {
                    participantStats[odId] = { name: userName, success: 0, fail: 0, tickets: 0 };
                }
                
                if (result === '成功') {
                    participantStats[odId].success++;
                    participantStats[odId].tickets += tickets;
                } else {
                    participantStats[odId].fail++;
                }
            }
            
            const sortedParticipants = Object.values(participantStats)
                .map(p => ({ ...p, rate: (p.success / (p.success + p.fail) * 100) }))
                .sort((a, b) => b.tickets - a.tickets || b.rate - a.rate);
            
            const embed = new EmbedBuilder()
                .setTitle(`🎫 ${eventName}`)
                .setColor(0x9b59b6)
                .setTimestamp()
                .addFields(
                    { name: '✅ 成功', value: String(eventStats.success), inline: true },
                    { name: '❌ 失敗', value: String(eventStats.fail), inline: true },
                    { name: '📈 成功率', value: `${eventStats.rate.toFixed(1)}%`, inline: true },
                    { name: '🎟️ 總張數', value: `${eventStats.totalTickets} 張`, inline: true }
                );
            
            if (sortedParticipants.length > 0) {
                const lines = sortedParticipants.map(p => 
                    `**${p.name}**: ${p.rate.toFixed(0)}% (✅${p.success} ❌${p.fail}) | 🎟️ ${p.tickets}張`
                );
                embed.addFields({ name: `👥 參與者 (${sortedParticipants.length}人)`, value: lines.join('\n').slice(0, 1024), inline: false });
            }
            
            await interaction.editReply({ embeds: [embed] });
        }
        
        // ===== /刪除 =====
        else if (commandName === '刪除') {
            await interaction.deferReply({ ephemeral: true });
            
            const userId = interaction.user.id;
            const deleted = await deleteLastRecord(userId);
            
            if (!deleted) {
                await interaction.editReply({ content: '❌ 你沒有任何記錄可以刪除！' });
                return;
            }
            
            const embed = new EmbedBuilder()
                .setTitle('🗑️ 已刪除記錄')
                .setDescription(`已刪除：${deleted.result === '成功' ? `✅ 成功 (${deleted.ticketCount}張)` : '❌ 失敗'} - ${deleted.event}`)
                .setColor(0xffa500);
            
            await interaction.editReply({ embeds: [embed] });
        }
        
        // ===== /幫助 =====
        else if (commandName === '幫助') {
            const embed = new EmbedBuilder()
                .setTitle('🎫 搶票記錄機器人 - 使用說明')
                .setColor(0x0099ff)
                .addFields(
                    {
                        name: '📝 記錄指令',
                        value: '`/成功 <活動> <張數> [日期] [備註]` - 記錄搶票成功\n`/失敗 <活動> [日期] [備註]` - 記錄搶票失敗\n`/刪除` - 刪除最後一筆記錄',
                        inline: false
                    },
                    {
                        name: '📊 統計指令',
                        value: '`/我的統計` - 查看個人統計\n`/查詢成員 <@成員>` - 查看他人統計\n`/全員統計` - 查看所有人統計\n`/排行榜 [排序]` - 排行榜',
                        inline: false
                    },
                    {
                        name: '🎫 活動指令',
                        value: '`/活動列表` - 查看所有活動\n`/活動詳情 <活動>` - 查看活動詳細統計',
                        inline: false
                    },
                    {
                        name: '🎊 趣味指令',
                        value: '`/有票噴霧` - 慶祝搶到票！',
                        inline: false
                    },
                    {
                        name: '💡 小提示',
                        value: '• 所有資料都會同步到 Google Sheets\n• 可以隨時在 Sheets 查看完整記錄\n• 輸入活動名稱時會自動顯示已有活動',
                        inline: false
                    }
                );
            
            await interaction.reply({ embeds: [embed] });
        }
        
        // ===== /有票噴霧 =====
        else if (commandName === '有票噴霧') {
            const imagePath = path.join(__dirname, 'images.jpg');
            
            if (!fs.existsSync(imagePath)) {
                await interaction.reply({ content: '❌ 找不到圖片檔案！', ephemeral: true });
                return;
            }
            
            const attachment = new AttachmentBuilder(imagePath);
            await interaction.reply({ files: [attachment] });
        }
        
    } catch (error) {
        console.error('❌ 指令執行錯誤:', error);
        const errorMessage = '❌ 執行指令時發生錯誤，請稍後再試';
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
        }
    }
});

// 啟動
const TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!TOKEN) {
    console.log('❌ 請設定環境變數 DISCORD_BOT_TOKEN');
    process.exit(1);
}

if (!SPREADSHEET_ID) {
    console.log('❌ 請設定環境變數 GOOGLE_SHEETS_ID');
    process.exit(1);
}

client.login(TOKEN);
